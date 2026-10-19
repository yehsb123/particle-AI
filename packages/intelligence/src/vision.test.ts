import { describe, it, expect } from "vitest";
import { ScreenReading } from "@particle/contracts";
import type { IntelligenceProvider } from "./provider";
import { supportsVision } from "./provider";
import { MockProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

/** A one-pixel png, as a provider would be handed it. */
const PIXEL = {
  mediaType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
} as const;

const request = {
  purpose: "read.screen",
  capability: "vision",
  structured: true,
  images: [PIXEL],
  context: { app: "KakaoTalk", window: "chat", width: 784, height: 527 },
} as const;

describe("the provider abstraction, widened to take a picture", () => {
  it("says which providers can be handed one", () => {
    expect(supportsVision(new MockProvider())).toBe(true);
    expect(supportsVision(new AnthropicProvider({ apiKey: "sk-not-used" }))).toBe(true);
    // the OpenAI-compatible adapter declares no vision capability and has no method for one
    expect(supportsVision(new OpenAICompatibleProvider())).toBe(false);
  });

  /**
   * A provider that merely CLAIMS vision is not one that can be handed a picture. The claim is a
   * string in a list and anything can put it there; the method is the thing a caller needs.
   */
  it("does not believe a provider that claims vision without a way to take one", () => {
    const liar: IntelligenceProvider = {
      id: "liar",
      capabilities: ["vision"],
      evaluate: async () => ({ providerId: "liar" }),
      health: async () => ({ id: "liar", healthy: true }),
    };
    expect(supportsVision(liar)).toBe(false);
  });

  it("routes a picture to the mock brain when no key is configured", async () => {
    const mock = new MockProvider();
    expect(mock.capabilities).toContain("vision");
    const result = await mock.evaluateVision(request);
    expect(result.providerId).toBe("mock");
    expect(result.tier).toBe("free");
    const reading = ScreenReading.safeParse(result.data);
    expect(reading.success, JSON.stringify(result.data)).toBe(true);
  });

  it("reads the same picture the same way twice, because it is deterministic", async () => {
    const mock = new MockProvider();
    const first = await mock.evaluateVision(request);
    const second = await mock.evaluateVision(request);
    expect(first.data).toEqual(second.data);
  });

  /**
   * The mock does not look at the pixels, and what it answers has to be honest about that: it
   * says it cannot tell, with no confidence, rather than inventing a situation nobody observed.
   */
  it("says it cannot tell rather than inventing a situation", async () => {
    const reading = ScreenReading.parse((await new MockProvider().evaluateVision(request)).data);
    expect(reading.activity).toBe("unclear");
    expect(reading.confidence).toBe(0);
    expect(reading.needsAttention).toBe(false);
    expect(reading.summary).toContain("KakaoTalk");
  });

  it("still answers when nothing says which window the picture is of", async () => {
    const reading = ScreenReading.parse(
      (await new MockProvider().evaluateVision({ purpose: "read.screen", capability: "vision", images: [PIXEL] })).data,
    );
    expect(reading.activity).toBe("unclear");
    expect(reading.summary.length).toBeGreaterThan(0);
  });

  /** Asked something else about a picture, it answers nothing rather than a reading of a window. */
  it("does not answer a question nobody asked with a screen reading", async () => {
    const result = await new MockProvider().evaluateVision({
      purpose: "describe.photo",
      capability: "vision",
      images: [PIXEL],
    });
    expect(result.data).toBeUndefined();
    expect(result.text).toBe("");
  });

  it("refuses a request with no picture in it", async () => {
    await expect(
      new MockProvider().evaluateVision({ purpose: "read.screen", capability: "vision", images: [] }),
    ).rejects.toThrow(/picture/i);
  });
});
