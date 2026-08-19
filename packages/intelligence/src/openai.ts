import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ModelTier,
  ProviderHealth,
} from "@dm/contracts";
import type { IntelligenceProvider } from "./provider";
import { jsonFromText, postJson } from "./http";

export type OpenAICompatibleOptions = {
  id?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  tier?: ModelTier;
};

/**
 * OpenAI-compatible chat-completions adapter. Serves both the hosted OpenAI API and any
 * OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM) — used by both OpenAIProvider
 * and LocalModelProvider below.
 */
export class OpenAICompatibleProvider implements IntelligenceProvider {
  readonly id: string;
  readonly capabilities: ModelCapability[] = [
    "reason.general",
    "reason.deep",
    "code",
    "structured_generation",
  ];
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly tier: ModelTier;

  constructor(opts: OpenAICompatibleOptions = {}) {
    this.id = opts.id ?? "openai";
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "gpt-4o-mini";
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.tier = opts.tier ?? "standard";
  }

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResult> {
    const started = Date.now();
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    const userContent = [request.prompt ?? "", request.context ? `\n\nCONTEXT:\n${JSON.stringify(request.context)}` : ""].join("");

    const res = (await postJson(
      `${this.baseUrl}/chat/completions`,
      headers,
      {
        model: this.model,
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: userContent },
        ],
        ...(request.structured ? { response_format: { type: "json_object" } } : {}),
      },
      request.latencyTargetMs ?? 30_000,
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

    const text = res.choices?.[0]?.message?.content ?? "";
    const data = request.structured ? jsonFromText(text) : undefined;
    return {
      providerId: this.id,
      modelId: this.model,
      text,
      data,
      latencyMs: Date.now() - started,
      tier: this.tier,
      usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens },
    };
  }

  async health(): Promise<ProviderHealth> {
    // Hosted needs a key; local (no key, custom baseUrl) is considered configured if baseUrl set.
    const configured = !!this.apiKey || !this.baseUrl.includes("api.openai.com");
    return { id: this.id, healthy: configured, detail: configured ? undefined : "no API key" };
  }
}

/** Hosted OpenAI. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(opts: Omit<OpenAICompatibleOptions, "id"> = {}) {
    super({ ...opts, id: "openai", apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY, tier: "standard" });
  }
}

/** Local, OpenAI-compatible model endpoint (privacy-preserving, no cloud). */
export class LocalModelProvider extends OpenAICompatibleProvider {
  constructor(opts: Omit<OpenAICompatibleOptions, "id"> = {}) {
    super({
      id: "local",
      apiKey: opts.apiKey,
      model: opts.model ?? process.env.DM_LOCAL_MODEL_NAME ?? "local-model",
      baseUrl: opts.baseUrl ?? process.env.DM_LOCAL_MODEL_BASE_URL ?? "http://localhost:11434/v1",
      tier: "local",
    });
  }
}
