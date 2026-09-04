import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { DecisionEngine, deterministicDecision, fallbackReason } from "./index";
import { IntelligenceRouter, AnthropicProvider } from "@particle/intelligence";
import { RuntimeDecision, emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";

/**
 * When the brain cannot be trusted — unreachable, slow, or answering with something that is not
 * a decision — the runtime falls back to a decision it computed itself, and records why. The why
 * is read in the inspector, written to the audit trail and broadcast to every connected client,
 * so it has to say what happened without saying where we were calling or what came back.
 */
const T = "2026-09-04T00:00:00Z";
const event: MatterEvent = { id: "e1", sessionId: "s", timestamp: T, source: "development", type: "development.server_error", severity: "critical", payload: {} };
const world: WorldState = {
  ...emptyWorldState("s", T),
  activeContext: { activity: "development" },
  activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e1", openedAt: T }],
};
const ctx = { event, worldState: world, significance: { score: 0.9, reasonCodes: [], shouldDeliberate: true } };

const validDecision = {
  id: "d-from-model",
  significance: 0.9,
  worldStateUpdates: [],
  capabilityPlan: { capabilities: [] },
  uiPlan: { intent: "surface_incident", targetMode: "incident", confidence: 0.9, reasonSummary: "the service is failing" },
  autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
  reasonSummary: "the service is failing",
};

let server: Server;
let base = "";
let answer: () => { code: number; text: string } = () => ({ code: 200, text: "{}" });

const say = (payload: unknown) => ({ code: 200, text: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }) });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const a = answer();
      res.writeHead(a.code, { "content-type": "application/json" });
      res.end(a.text);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const evaluate = () =>
  new DecisionEngine(new IntelligenceRouter([new AnthropicProvider({ apiKey: "test-key", baseUrl: `${base}/v1/messages` })])).evaluate(ctx);

const codeOf = (codes: string[]) => codes.find((c) => c.startsWith("fell_back_to_deterministic:"));

describe("when the model answers properly", () => {
  it("uses what it said, without falling back", async () => {
    answer = () => say(validDecision);
    const out = await evaluate();
    expect(out.usedFallback).toBe(false);
    expect(out.decision.id).toBe("d-from-model");
    expect(codeOf(out.route.reasonCodes)).toBeUndefined();
    expect(out.providerId).toBe("anthropic");
  });
});

describe("when it does not", () => {
  it("falls back on an answer that is not a decision, and says so", async () => {
    answer = () => say({ id: "d1", uiPlan: { intent: "explode" } });
    const out = await evaluate();
    expect(out.usedFallback).toBe(true);
    expect(codeOf(out.route.reasonCodes)).toBe("fell_back_to_deterministic:invalid_output");
    expect(out.decision.id).not.toBe("d1");
  });

  it("names the status when the provider refuses, and nothing else", async () => {
    // the provider's own message carries our endpoint (host and port) and its response body;
    // a port also made the code different on every run, which defeats the point of a code
    for (const [status, body] of [[503, '{"error":{"message":"upstream capacity exceeded for org acct_12345"}}'], [401, '{"error":{"message":"invalid x-api-key test-key"}}'], [429, "slow down"]] as [number, string][]) {
      answer = () => ({ code: status, text: body });
      const out = await evaluate();
      const code = codeOf(out.route.reasonCodes)!;
      expect(code).toBe(`fell_back_to_deterministic:http_${status}`);
      expect(code).not.toContain("127.0.0.1");
      expect(code).not.toContain("acct_12345");
      expect(code).not.toContain("test-key");
    }
  });

  it("falls back on prose with no decision in it", async () => {
    answer = () => ({ code: 200, text: JSON.stringify({ content: [{ type: "text", text: "I think the UI should change." }] }) });
    const out = await evaluate();
    expect(out.usedFallback).toBe(true);
    expect(codeOf(out.route.reasonCodes)).toBe("fell_back_to_deterministic:unparseable_output");
  });

  it("still hands back a decision the schema accepts, whatever went wrong", async () => {
    for (const ans of [
      () => ({ code: 500, text: "boom" }),
      () => ({ code: 200, text: "not json at all" }),
      () => say({ nonsense: true }),
      () => say(null),
    ]) {
      answer = ans;
      const out = await evaluate();
      expect(out.usedFallback).toBe(true);
      expect(RuntimeDecision.safeParse(out.decision).success).toBe(true);
      expect(out.decision.reasonSummary.length).toBeGreaterThan(0);
    }
  });

  it("keeps the routing story alongside the fallback, so the trail is complete", async () => {
    answer = () => ({ code: 500, text: "boom" });
    const out = await evaluate();
    expect(out.route.reasonCodes).toContain("chose:anthropic");
    expect(out.route.reasonCodes.some((c) => c.startsWith("capability:"))).toBe(true);
    expect(codeOf(out.route.reasonCodes)).toBe("fell_back_to_deterministic:http_500");
  });
});

describe("fallbackReason on its own", () => {
  it("prefers the status a failed request carried", () => {
    expect(fallbackReason(Object.assign(new Error("http://internal.host:9000/v1 → HTTP 503: body"), { status: 503 }))).toBe("http_503");
    expect(fallbackReason(Object.assign(new Error("x"), { status: 400 }))).toBe("http_400");
  });

  it("recognises a request that never came back", () => {
    expect(fallbackReason(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("timeout");
    expect(fallbackReason(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe("timeout");
  });

  it("recognises a missing key and an answer with no decision in it", () => {
    expect(fallbackReason(new Error("AnthropicProvider: no API key"))).toBe("no_api_key");
    expect(fallbackReason(new Error("no JSON value found in model response"))).toBe("unparseable_output");
  });

  it("says only that something went wrong when it cannot tell what", () => {
    for (const err of [new Error("connect ECONNREFUSED 10.0.0.5:8080"), new Error(""), "a bare string", null, undefined, { status: "503" }]) {
      expect(fallbackReason(err), String(err)).toBe("provider_error");
    }
  });

  it("never repeats back an endpoint, a key or a response body", () => {
    const err = Object.assign(new Error("http://10.0.0.5:9000/v1/messages → HTTP 401: {\"message\":\"invalid key sk-abc123\"}"), { status: 401 });
    const code = fallbackReason(err);
    expect(code).toBe("http_401");
    expect(code).not.toContain("10.0.0.5");
    expect(code).not.toContain("sk-abc123");
  });

  it("gives the same code every time for the same failure", () => {
    const codes = new Set([503, 503, 503].map((s) => fallbackReason(Object.assign(new Error(`http://127.0.0.1:${Math.random()}/v1 → HTTP 503`), { status: s }))));
    expect(codes.size).toBe(1);
  });
});

describe("the decision the runtime computes for itself", () => {
  it("is the same every time for the same situation", () => {
    expect(JSON.stringify(deterministicDecision(ctx))).toBe(JSON.stringify(deterministicDecision(ctx)));
  });

  it("passes the same schema a model's answer has to pass", () => {
    expect(RuntimeDecision.safeParse(deterministicDecision(ctx)).success).toBe(true);
  });

  it("surfaces the incident when something is open, and restores normal when nothing is", () => {
    expect(deterministicDecision(ctx).uiPlan?.intent).toBe("surface_incident");
    const calm = { ...ctx, worldState: { ...world, activeProblems: [] }, event: { ...event, type: "development.server_recovered", severity: "info" as const } };
    expect(deterministicDecision(calm).uiPlan?.intent).toBe("restore_normal");
  });

  it("ties itself to the event it answered, so the trail can be followed", () => {
    expect(deterministicDecision(ctx).id).toContain(event.id);
  });

  it("never asks for more autonomy than reading", () => {
    const d = deterministicDecision(ctx);
    expect(["read", "safe_write"]).toContain(d.autonomyRequirement.risk);
    expect(d.autonomyRequirement.minLevel).toBeLessThanOrEqual(2);
  });
});
