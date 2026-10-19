import { describe, it, expect } from "vitest";
import { SCREEN_ACTIVITIES } from "@particle/contracts";
import { AnthropicProvider } from "./anthropic";
import { readScreen } from "./screen";

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

/**
 * The screen-reading path against the real API, once, when somebody has a key.
 *
 * A one-pixel png is the whole point: it proves the wire format, the image block and the schema
 * round-trip for a few hundred tokens, and there is nothing in it to read — so running this test
 * never sends a picture of anybody's screen anywhere.
 */
describe.skipIf(!key)("reading a picture with the real API (live)", () => {
  it("comes back with a reading that fits the schema", async () => {
    const provider = new AnthropicProvider({ apiKey: key, model: "claude-haiku-4-5-20251001" });
    const result = await readScreen(provider, {
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      mediaType: "image/png",
      app: "probe",
      window: "one pixel",
      width: 1,
      height: 1,
    });
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;
    expect(SCREEN_ACTIVITIES as readonly string[]).toContain(result.reading.activity);
    expect(result.providerId).toBe("anthropic");
  }, 60_000);
});

describe("AnthropicProvider (offline)", () => {
  it("is unhealthy and refuses to evaluate without a key", async () => {
    const p = new AnthropicProvider({ apiKey: undefined });
    expect((await p.health()).healthy).toBe(false);
    await expect(p.evaluate({ purpose: "x", capability: "reason.deep" })).rejects.toThrow();
  });
});
