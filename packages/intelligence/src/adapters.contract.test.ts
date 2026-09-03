import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai";
import type { IntelligenceRequest } from "@particle/contracts";

/** Minimal valid request — the adapters under test only look at prompt/system/context/structured/latency. */
const mkReq = (r: Partial<IntelligenceRequest>): IntelligenceRequest => ({ purpose: "contract-test", capability: "structured_generation", ...r });

/**
 * Provider HTTP contract — proven WITHOUT real keys. A local fake API records what the adapters
 * send and answers like the real services do, so the wire format, auth headers, structured
 * extraction, usage mapping, and every failure path (HTTP error, no JSON, timeout) are tested on
 * every push. The live test (anthropic.live.test.ts) still runs when a key is present.
 */
type Seen = { url: string; method: string; headers: Record<string, string | string[] | undefined>; body: unknown };
let server: Server;
let base = "";
const seen: Seen[] = [];
let mode: "anthropic-ok" | "openai-ok" | "http-500" | "no-json" | "slow" = "anthropic-ok";

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ url: req.url ?? "", method: req.method ?? "", headers: req.headers, body });
    const send = (code: number, payload: unknown, delayMs = 0) =>
      setTimeout(() => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      }, delayMs);
    switch (mode) {
      case "anthropic-ok":
        return send(200, {
          id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5",
          content: [{ type: "text", text: "Here is the decision:\n```json\n{\"ok\":true,\"n\":1}\n```" }],
          usage: { input_tokens: 5, output_tokens: 7 },
        });
      case "openai-ok":
        return send(200, {
          id: "chatcmpl_1", choices: [{ index: 0, message: { role: "assistant", content: "{\"a\":1}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        });
      case "http-500":
        return send(500, { error: { type: "server_error", message: "boom" } });
      case "no-json":
        return send(200, { content: [{ type: "text", text: "I would rather not answer in JSON." }], usage: {} });
      case "slow":
        return send(200, { content: [{ type: "text", text: "{}" }] }, 800);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("AnthropicProvider ↔ Messages API contract (fake server, no key needed)", () => {
  it("sends the Messages API shape with auth headers and returns validated structured data + usage", async () => {
    mode = "anthropic-ok";
    seen.length = 0;
    const p = new AnthropicProvider({ apiKey: "test-key", baseUrl: `${base}/v1/messages`, model: "claude-sonnet-5", maxTokens: 256 });
    expect((await p.health()).healthy).toBe(true);
    const out = await p.evaluate(mkReq({ system: "You are the brain.", prompt: "Decide.", context: { problems: 1 }, structured: true }));

    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/messages");
    expect(req.headers["x-api-key"]).toBe("test-key");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    const body = req.body as { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(256);
    expect(body.system).toBe("You are the brain.");
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.content).toContain("Decide.");
    expect(body.messages[0]?.content).toContain("\"problems\":1"); // context travels as JSON, not prose

    expect(out.providerId).toBe("anthropic");
    expect(out.modelId).toBe("claude-sonnet-5");
    expect(out.data).toEqual({ ok: true, n: 1 }); // fenced JSON extracted, prose ignored
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(out.tier).toBe("premium");
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("refuses to call the network at all without a key", async () => {
    seen.length = 0;
    const p = new AnthropicProvider({ apiKey: undefined, baseUrl: `${base}/v1/messages` });
    // guard against a key leaking in from the environment
    if ((await p.health()).healthy) return;
    await expect(p.evaluate(mkReq({ prompt: "x" }))).rejects.toThrow(/no API key/);
    expect(seen).toHaveLength(0);
  });

  it("surfaces an HTTP error instead of inventing a decision", async () => {
    mode = "http-500";
    const p = new AnthropicProvider({ apiKey: "k", baseUrl: `${base}/v1/messages` });
    await expect(p.evaluate(mkReq({ prompt: "x", structured: true }))).rejects.toThrow();
  });

  it("rejects when a structured answer contains no JSON (the decision engine then falls back)", async () => {
    mode = "no-json";
    const p = new AnthropicProvider({ apiKey: "k", baseUrl: `${base}/v1/messages` });
    await expect(p.evaluate(mkReq({ prompt: "x", structured: true }))).rejects.toThrow(/no JSON/);
  });

  it("honours the latency target with a hard timeout", async () => {
    mode = "slow";
    const p = new AnthropicProvider({ apiKey: "k", baseUrl: `${base}/v1/messages` });
    await expect(p.evaluate(mkReq({ prompt: "x", latencyTargetMs: 150 }))).rejects.toThrow();
  });
});

describe("OpenAICompatibleProvider ↔ chat/completions contract (fake server)", () => {
  it("sends system+user messages, a Bearer token and json_object mode; maps usage", async () => {
    mode = "openai-ok";
    seen.length = 0;
    const p = new OpenAICompatibleProvider({ id: "openai", apiKey: "sk-test", baseUrl: `${base}/v1`, model: "gpt-4o-mini", tier: "standard" });
    const out = await p.evaluate(mkReq({ system: "sys", prompt: "hello", structured: true }));

    const req = seen[0]!;
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.headers["authorization"]).toBe("Bearer sk-test");
    const body = req.body as { model: string; messages: { role: string; content: string }[]; response_format?: { type: string } };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.response_format).toEqual({ type: "json_object" });

    expect(out.providerId).toBe("openai");
    expect(out.data).toEqual({ a: 1 });
    expect(out.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it("works as a LOCAL model endpoint: no key, no Authorization header, still healthy", async () => {
    mode = "openai-ok";
    seen.length = 0;
    const p = new OpenAICompatibleProvider({ id: "local", baseUrl: `${base}/v1`, model: "llama", tier: "local" });
    expect((await p.health()).healthy).toBe(true); // custom base URL counts as configured
    const out = await p.evaluate(mkReq({ prompt: "hi" }));
    expect(seen[0]!.headers["authorization"]).toBeUndefined();
    expect(out.providerId).toBe("local");
    expect(out.text).toBe("{\"a\":1}");
    expect(out.data).toBeUndefined(); // not structured → raw text only
  });

  it("surfaces HTTP errors", async () => {
    mode = "http-500";
    const p = new OpenAICompatibleProvider({ apiKey: "k", baseUrl: `${base}/v1` });
    await expect(p.evaluate(mkReq({ prompt: "x" }))).rejects.toThrow();
  });
});
