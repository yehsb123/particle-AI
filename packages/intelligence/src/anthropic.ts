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
 * One Messages request, built in one place so that the probe in `anthropic.smoke.ts` cannot
 * drift from what the provider really sends.
 *
 * `thinking` is named rather than left out because leaving it out does not turn thinking off on
 * these models — it only hides the decision. A thinking budget is deliberately absent: this
 * model rejects `budget_tokens` outright, and depth is a matter of effort, not of a number here.
 */
export function anthropicRequest(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  content: unknown;
}): { headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
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
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
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
    if (!this.apiKey) throw new ProviderError("no_api_key", "AnthropicProvider: no API key");
    const started = Date.now();
    const { headers, body } = anthropicRequest({
      apiKey: this.apiKey,
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
    return { id: this.id, healthy: !!this.apiKey, detail: this.apiKey ? undefined : "no ANTHROPIC_API_KEY" };
  }
}
