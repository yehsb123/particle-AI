import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@particle/contracts";
import type { VisionProvider, VisionRequest } from "./provider";
import { ProviderError } from "./failure";
import { jsonFromText, postJson } from "./http";

/** The words of one request: what was asked, and the structured context it is about. */
function userText(request: IntelligenceRequest): string {
  return [request.prompt ?? "", request.context ? `\n\nCONTEXT:\n${JSON.stringify(request.context)}` : ""].join("");
}

export type AnthropicOptions = {
  apiKey?: string;
  /** An OAuth access token, for somebody who logged in rather than pasting a key. */
  authToken?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
};

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

/**
 * How much room one answer gets.
 *
 * Thinking is spent out of this same ceiling, and on this model it is on whether or not we ask
 * for it — so the old 1024 was a budget the model could finish thinking inside and have nothing
 * left to say with, which arrived here as a blank body that looked like a successful answer.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000;

/** The ways a turn can end having actually answered. Anything else is a failure to report. */
const CLEAN_STOP_REASONS = new Set(["end_turn", "stop_sequence"]);

export type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/**
 * What this account is allowed to ask with: a key somebody pasted, or a login somebody did.
 *
 * A static key and an OAuth access token go to the same endpoint under different headers, and a
 * token also needs the beta flag that opts the request into OAuth at all. Keeping both as one
 * value means the provider, the probe and anything added later cannot send one of them the way
 * the other is sent.
 */
export type AnthropicCredential = { kind: "api_key" | "oauth"; value: string };

/** The OAuth beta the Messages API requires before it will read a Bearer token at all. */
const OAUTH_BETA = "oauth-2025-04-20";

export function authHeaders(credential: AnthropicCredential): Record<string, string> {
  if (credential.kind === "api_key") return { "x-api-key": credential.value };
  return { authorization: `Bearer ${credential.value}`, "anthropic-beta": OAUTH_BETA };
}

/**
 * The credential the environment is carrying, or null when it carries none.
 *
 * A key wins over a login, which is the order the Anthropic tooling resolves them in: somebody
 * who exported a key meant to use that key, and a stale login left on disk should not quietly
 * take its place. An empty value counts as absent rather than as an empty key.
 */
export function credentialFromEnv(env: Record<string, string | undefined> = process.env): AnthropicCredential | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) return { kind: "api_key", value: key };
  const token = env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (token) return { kind: "oauth", value: token };
  return null;
}

/**
 * One Messages request, built in one place so that the probe in `anthropic.smoke.ts` cannot
 * drift from what the provider really sends.
 *
 * `thinking` is named rather than left out because leaving it out does not turn thinking off on
 * these models — it only hides the decision. A thinking budget is deliberately absent: this
 * model rejects `budget_tokens` outright, and depth is a matter of effort, not of a number here.
 */
export function anthropicRequest(opts: {
  credential: AnthropicCredential;
  model: string;
  maxTokens: number;
  system?: string;
  content: unknown;
}): { headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    headers: { ...authHeaders(opts.credential), "anthropic-version": "2023-06-01" },
    body: {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: opts.content }],
    },
  };
}

/**
 * Why this turn ended, when it did not end by answering — or null when it did.
 *
 * The text is for whoever reads the failure, so it carries the reason the API gave and, for a
 * refusal, the category it declined under. It does not carry the body: a turn that stopped at
 * `max_tokens` has one, half-written, and passing half an answer on as if it were whole is the
 * thing this exists to stop.
 */
export function stopFailure(res: AnthropicResponse, textLength: number): string | null {
  const reason = res.stop_reason;
  if (!reason || CLEAN_STOP_REASONS.has(reason)) return null;
  const category = res.stop_details?.category ? `, category ${res.stop_details.category}` : "";
  const explanation = res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "";
  return `stopped with stop_reason "${reason}"${category} after ${textLength} characters of body${explanation}`;
}

/**
 * Anthropic Messages API adapter (plain fetch, no SDK dependency). Only used when an API key
 * is configured; otherwise the router falls back to the mock provider.
 */
export class AnthropicProvider implements VisionProvider {
  readonly id = "anthropic";
  readonly capabilities: ModelCapability[] = [
    "reason.general",
    "reason.deep",
    "code",
    "structured_generation",
    "vision",
  ];
  private readonly credential: AnthropicCredential | null;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.credential = opts.apiKey?.trim()
      ? { kind: "api_key", value: opts.apiKey.trim() }
      : opts.authToken?.trim()
        ? { kind: "oauth", value: opts.authToken.trim() }
        : credentialFromEnv();
    this.model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? ANTHROPIC_MESSAGES_URL;
    this.maxTokens = opts.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
  }

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResult> {
    return this.ask(request, userText(request));
  }

  /**
   * The same request with pictures in front of the words.
   *
   * The Messages API takes a user turn as a list of blocks, and an image is one of them; the
   * image goes first because a model reads the instruction as being about what it has just been
   * shown. Nothing else about the request changes, which is the point of widening the
   * abstraction rather than writing a second adapter.
   */
  async evaluateVision(request: VisionRequest): Promise<IntelligenceResult> {
    if (request.images.length === 0) {
      throw new Error("AnthropicProvider: a vision request with no picture in it");
    }
    return this.ask(request, [
      ...request.images.map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.base64 },
      })),
      { type: "text", text: userText(request) },
    ]);
  }

  /** One user turn, however it is spelled: a string of text, or a list of blocks with a picture in it. */
  private async ask(request: IntelligenceRequest, content: unknown): Promise<IntelligenceResult> {
    if (!this.credential) throw new ProviderError("no_api_key", "AnthropicProvider: no API key and no login");
    const started = Date.now();
    const { headers, body } = anthropicRequest({
      credential: this.credential,
      model: this.model,
      maxTokens: this.maxTokens,
      system: request.system,
      content,
    });
    const res = (await postJson(
      this.baseUrl,
      headers,
      body,
      request.latencyTargetMs ?? 30_000,
    )) as AnthropicResponse;

    const text = (res.content ?? []).map((c) => c.text ?? "").join("");
    const failure = stopFailure(res, text.length);
    if (failure) throw new ProviderError("incomplete_turn", `AnthropicProvider: ${this.model} ${failure}`);
    const data = request.structured ? jsonFromText(text) : undefined;
    return {
      providerId: this.id,
      modelId: this.model,
      text,
      data,
      latencyMs: Date.now() - started,
      tier: "premium",
      usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      id: this.id,
      healthy: !!this.credential,
      detail: this.credential ? undefined : "no ANTHROPIC_API_KEY and no ANTHROPIC_AUTH_TOKEN",
    };
  }
}
