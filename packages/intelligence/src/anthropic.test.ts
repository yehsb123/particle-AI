import { describe, it, expect, afterEach, vi } from "vitest";
import { AnthropicProvider } from "./anthropic";

/**
 * The Messages API, faked at the wire: these tests are about what this adapter SENDS and what it
 * believes of what comes back, and both of those are decided before any network exists. Nothing
 * here needs a key, and nothing here spends one.
 */
function fakeApi(payload: unknown): { body: Record<string, unknown> }[] {
  const calls: { body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

const ask = { purpose: "smoke", capability: "reason.general", prompt: "say something" } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a turn that did not end on its own terms", () => {
  it("refuses to report a body that was cut off for want of room", async () => {
    fakeApi({
      content: [{ type: "text", text: "" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 12, output_tokens: 1024 },
    });
    const provider = new AnthropicProvider({ apiKey: "sk-not-used" });
    await expect(provider.evaluate(ask)).rejects.toThrow(/max_tokens/);
  });

  it("refuses to report a body the model declined to write, and says what it was declined for", async () => {
    fakeApi({
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
    });
    const provider = new AnthropicProvider({ apiKey: "sk-not-used" });
    await expect(provider.evaluate(ask)).rejects.toThrow(/refusal/);
    await expect(provider.evaluate(ask)).rejects.toThrow(/cyber/);
  });

  it("hands back the body of a turn that ended by itself", async () => {
    fakeApi({ content: [{ type: "text", text: "something" }], stop_reason: "end_turn" });
    const provider = new AnthropicProvider({ apiKey: "sk-not-used" });
    await expect(provider.evaluate(ask)).resolves.toMatchObject({ text: "something" });
  });
});

describe("the request this adapter sends", () => {
  it("leaves the model room to answer after it has thought, and sends no budget it would reject", async () => {
    const calls = fakeApi({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    await new AnthropicProvider({ apiKey: "sk-not-used" }).evaluate(ask);

    const body = calls[0]!.body;
    expect(body.max_tokens).toBeGreaterThanOrEqual(16_000);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    expect(body).not.toHaveProperty("budget_tokens");
  });
});
