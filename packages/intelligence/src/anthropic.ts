import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@particle/contracts";
import type { VisionProvider, VisionRequest } from "./provider";
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
    this.model = opts.model ?? "claude-sonnet-5";
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1/messages";
    this.maxTokens = opts.maxTokens ?? 1024;
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
    if (!this.apiKey) throw new Error("AnthropicProvider: no API key");
    const started = Date.now();
    const res = (await postJson(
      this.baseUrl,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: request.system,
        messages: [{ role: "user", content }],
      },
      request.latencyTargetMs ?? 30_000,
    )) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };

    const text = (res.content ?? []).map((c) => c.text ?? "").join("");
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
