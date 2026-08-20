import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "./anthropic";

const key = process.env.ANTHROPIC_API_KEY;

// Only runs when a real key is configured; otherwise skipped (keeps offline runs green).
describe.skipIf(!key)("AnthropicProvider (live)", () => {
  it("reports healthy and returns structured JSON from the real API", async () => {
    const p = new AnthropicProvider({ apiKey: key, model: "claude-haiku-4-5-20251001" });
    expect((await p.health()).healthy).toBe(true);

    const res = await p.evaluate({
      purpose: "smoke",
      capability: "structured_generation",
      structured: true,
      system: 'Return ONLY a JSON object of the form {"ok": true}. No prose.',
      prompt: "Emit the JSON now.",
    });

    expect(res.providerId).toBe("anthropic");
    expect(res.data).toBeTruthy();
  }, 30_000);
});

describe("AnthropicProvider (offline)", () => {
  it("is unhealthy and refuses to evaluate without a key", async () => {
    const p = new AnthropicProvider({ apiKey: undefined });
    expect((await p.health()).healthy).toBe(false);
    await expect(p.evaluate({ purpose: "x", capability: "reason.deep" })).rejects.toThrow();
  });
});
