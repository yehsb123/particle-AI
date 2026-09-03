import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { DecisionEngine, deterministicDecision } from "./index";
import { IntelligenceRouter, AnthropicProvider } from "@particle/intelligence";
import { emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";

/**
 * The REAL provider path end to end, without a key: router → AnthropicProvider (pointed at a
 * fake Messages API) → Zod validation → deterministic fallback. This is the guarantee behind
 * "invalid model output can never corrupt the runtime" — proven on the actual HTTP adapter,
 * not on a stub.
 */
const T = "2026-08-19T00:00:00Z";
const sig = { score: 0.9, reasonCodes: [], shouldDeliberate: true };
const event: MatterEvent = { id: "e1", sessionId: "s", timestamp: T, source: "development", type: "development.server_error", severity: "critical", payload: {} };
const world: WorldState = {
  ...emptyWorldState("s", T),
  activeContext: { activity: "development" },
  activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e1", openedAt: T }],
};
const ctx = { event, worldState: world, significance: sig };

let server: Server;
let base = "";
let answer: () => { code: number; text: string } = () => ({ code: 200, text: "{}" });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const a = answer();
      res.writeHead(a.code, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: a.text }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}/v1/messages` : "";
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function engine(): DecisionEngine {
  return new DecisionEngine(new IntelligenceRouter([new AnthropicProvider({ apiKey: "k", baseUrl: base })]));
}

describe("DecisionEngine over the real Anthropic adapter (fake API)", () => {
  it("uses a schema-valid model decision as-is", async () => {
    const modelDecision = { ...deterministicDecision(ctx), reasonSummary: "from the model" };
    answer = () => ({ code: 200, text: "```json\n" + JSON.stringify(modelDecision) + "\n```" });
    const out = await engine().evaluate(ctx);
    expect(out.providerId).toBe("anthropic");
    expect(out.usedFallback).toBe(false);
    expect(out.decision.reasonSummary).toBe("from the model");
    expect(out.decision.uiPlan?.intent).toBe("surface_incident");
  });

  it("discards a schema-INVALID model decision and falls back deterministically (never corrupts the runtime)", async () => {
    // looks like a decision, but uiPlan.intent is not in the allowed set and autonomy is garbage
    answer = () => ({ code: 200, text: JSON.stringify({ id: "x", significance: 0.5, capabilityPlan: { capabilities: [] }, uiPlan: { intent: "delete_everything", targetMode: "development", confidence: 1, reasonSummary: "!" }, autonomyRequirement: { minLevel: 99, requiresApproval: "no", risk: "yolo" }, reasonSummary: "evil" }) });
    const out = await engine().evaluate(ctx);
    expect(out.usedFallback).toBe(true);
    expect(out.decision.uiPlan?.intent).toBe("surface_incident"); // deterministic, still correct
    expect(out.decision.reasonSummary).not.toBe("evil");
    expect(out.route.reasonCodes).toContain("fell_back_to_deterministic:invalid_output");
  });

  it("falls back on a provider HTTP failure and records why", async () => {
    answer = () => ({ code: 503, text: "" });
    const out = await engine().evaluate(ctx);
    expect(out.usedFallback).toBe(true);
    expect(out.decision.uiPlan?.intent).toBe("surface_incident");
    expect(out.route.reasonCodes.some((r) => r.startsWith("fell_back_to_deterministic:"))).toBe(true);
  });

  it("falls back when the model answers in prose with no JSON", async () => {
    answer = () => ({ code: 200, text: "I think you should probably show the logs." });
    const out = await engine().evaluate(ctx);
    expect(out.usedFallback).toBe(true);
    expect(out.decision.uiPlan?.intent).toBe("surface_incident");
  });
});
