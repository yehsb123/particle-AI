import { describe, it, expect } from "vitest";
import { emptyWorldState, shapeOfEvent, MAX_IDENTIFIER, MAX_PAYLOAD_FIELDS, type MatterEvent, type ModelCapability } from "@particle/contracts";
import { DecisionEngine } from "./index";
import { IntelligenceRouter } from "@particle/intelligence";
import type { IntelligenceProvider } from "@particle/intelligence";

/**
 * The decision engine hands a provider three things as JSON: the event, the belief, and what the
 * reflex made of it. The belief was shaped last night. The event was not, and one carrying a
 * hundred kilobytes was ninety per cent of the prompt on its own — sent to somebody else's model,
 * paid for by the token, and liable to push everything that matters out of the window.
 *
 * None of it is what the decision turns on. The reflex reads the raw event before any of this,
 * because that is the sensor's report and the numbers in it are the signal; what leaves for a
 * provider is the shape.
 */
const T = "2026-09-06T00:00:00Z";
const ESC = "\u001b";
const event = (payload: Record<string, unknown>): MatterEvent => ({
  id: "e1", sessionId: "s", timestamp: T, source: "sensor", type: "network.request", severity: "warning", payload,
});
const size = (v: unknown) => JSON.stringify(v).length;

describe("the event a provider is shown", () => {
  it("is the event, still", () => {
    const shaped = shapeOfEvent(event({ host: "api.example.com" }));
    expect(shaped.id).toBe("e1");
    expect(shaped.type).toBe("network.request");
    expect(shaped.severity).toBe("warning");
    expect(shaped.timestamp).toBe(T);
  });

  it("keeps what a decision turns on", () => {
    const shaped = shapeOfEvent(event({ host: "api.example.com", status: 503, ms: 1800, error: true }));
    expect(shaped.payload).toEqual({ host: "api.example.com", status: 503, ms: 1800, error: true });
  });

  it("does not carry a payload the size of a prompt", () => {
    const shaped = shapeOfEvent(event({ host: "api.example.com", blob: "b".repeat(100_000) }));
    expect(size(shaped)).toBeLessThan(1_000);
    expect(shaped.payload.host).toBe("api.example.com");
  });

  it("holds a name to the same length everything else is", () => {
    const shaped = shapeOfEvent(event({ host: "h".repeat(50_000) }));
    expect((shaped.payload.host as string).length).toBe(MAX_IDENTIFIER + 1);
  });

  it("carries no escape sequence into somebody else's model", () => {
    expect(shapeOfEvent(event({ host: `api${ESC}[31m.example.com` })).payload.host).toBe("api[31m.example.com");
  });

  it("leaves behind what is content rather than shape", () => {
    const shaped = shapeOfEvent(event({ host: "api.example.com", body: { rows: [1, 2] }, list: [1] }));
    expect(shaped.payload).toEqual({ host: "api.example.com" });
  });

  it("is a handful of fields, however many a sender writes", () => {
    const many = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(shapeOfEvent(event(many)).payload).length).toBe(MAX_PAYLOAD_FIELDS);
  });

  it("leaves the event it was given untouched", () => {
    // the runtime keeps deciding, storing and replaying from the real one
    const original = event({ host: "api.example.com", blob: "b".repeat(1_000) });
    shapeOfEvent(original);
    expect((original.payload.blob as string).length).toBe(1_000);
  });
});

describe("what a provider actually receives", () => {
  /**
   * Catches the request the engine builds, which is the thing that becomes the prompt.
   *
   * The id decides which provider the router picks: it keeps a mock of its own beside whatever it
   * was given and hands deliberation to the most capable, so a capturing provider that called
   * itself the mock never saw a request at all.
   */
  class Capturing implements IntelligenceProvider {
    readonly id = "anthropic";
    readonly capabilities: ModelCapability[] = ["reason.deep"];
    seen?: { context?: { event?: MatterEvent } };
    async evaluate(request: { context?: { event?: MatterEvent } }) {
      this.seen = request;
      return { providerId: this.id, data: null };
    }
    async health() {
      return { id: this.id, healthy: true };
    }
  }

  const heavy = event({ host: "api.example.com", status: 503, ms: 1800, blob: "b".repeat(100_000) });

  it("gets the shape, and the payload it turns on inside it", async () => {
    const provider = new Capturing();
    const engine = new DecisionEngine(new IntelligenceRouter([provider]));
    await engine.evaluate({
      event: heavy,
      worldState: emptyWorldState("s", T),
      significance: { score: 0.9, shouldDeliberate: true, reasonCodes: ["severity_warning"] },
    });

    const sent = provider.seen?.context?.event;
    expect(sent).toBeDefined();
    // what the decision turns on, intact
    expect(sent!.payload.host).toBe("api.example.com");
    expect(sent!.payload.status).toBe(503);
    expect(sent!.payload.ms).toBe(1800);
    // and the blob still there as a name rather than gone: a string is trimmed, not dropped, the
    // same way the belief trims one, so a field nobody predicted is not silently lost
    expect((sent!.payload.blob as string).length).toBe(MAX_IDENTIFIER + 1);
    expect(size(sent)).toBeLessThan(1_000);
  });

  it("does not change the event the runtime keeps deciding, storing and replaying from", async () => {
    const provider = new Capturing();
    await new DecisionEngine(new IntelligenceRouter([provider])).evaluate({
      event: heavy,
      worldState: emptyWorldState("s", T),
      significance: { score: 0.9, shouldDeliberate: true, reasonCodes: [] },
    });
    expect((heavy.payload.blob as string).length).toBe(100_000);
  });
});
