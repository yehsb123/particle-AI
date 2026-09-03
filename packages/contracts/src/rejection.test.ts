import { describe, it, expect } from "vitest";
import {
  AutonomyLevel,
  IsoTimestamp,
  MatterEvent,
  RiskLevel,
  RuntimeDecision,
  UIBlueprint,
  UIComponent,
  UIPatch,
  emptyWorldState,
  WorldState,
  UI_SCHEMA_VERSION,
} from "./index";

/**
 * These schemas are the door every piece of outside data comes through: model output, sensor
 * events, anything posted to the runtime. What they REJECT is the actual safety property, so this
 * file is written from the outside in — malformed input first.
 */
const T = "2026-09-03T00:00:00Z";
const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("timestamps have to be readable", () => {
  it("takes a real ISO instant, with or without an offset", () => {
    for (const t of [T, "2026-09-03T00:00:00.123+09:00", "2026-09-03T00:00:00-05:00"]) {
      expect(accepts(IsoTimestamp, t), t).toBe(true);
    }
  });

  it("refuses anything a clock cannot be derived from", () => {
    // replay turns these into its clock; an unreadable one made every guard comparison false
    for (const t of ["yesterday", "2026-13-45T99:99:99Z", "1756860000000", "", "   ", "soon"]) {
      expect(accepts(IsoTimestamp, t), JSON.stringify(t)).toBe(false);
    }
  });

  it("keeps an event with an unreadable timestamp out of the runtime", () => {
    const event = { id: "e", sessionId: "s", source: "user", type: "user.action", severity: "info", payload: {} };
    expect(accepts(MatterEvent, { ...event, timestamp: T })).toBe(true);
    expect(accepts(MatterEvent, { ...event, timestamp: "yesterday" })).toBe(false);
  });
});

describe("events", () => {
  const base = { id: "e", sessionId: "s", timestamp: T, source: "user", type: "user.action", severity: "info", payload: {} };

  it("accepts a well-formed event", () => {
    expect(accepts(MatterEvent, base)).toBe(true);
  });

  it("insists on identity, a known source and a known severity", () => {
    expect(accepts(MatterEvent, { ...base, id: "" })).toBe(false);
    expect(accepts(MatterEvent, { ...base, sessionId: "" })).toBe(false);
    expect(accepts(MatterEvent, { ...base, type: "" })).toBe(false);
    expect(accepts(MatterEvent, { ...base, source: "aliens" })).toBe(false);
    expect(accepts(MatterEvent, { ...base, severity: "fatal" })).toBe(false);
    expect(accepts(MatterEvent, { ...base, payload: undefined })).toBe(false);
  });

  it("takes any shape of payload — that is the sensors' vocabulary, not ours", () => {
    for (const payload of [{}, { host: "a", status: 503 }, { nested: { deep: [1, 2, 3] } }]) {
      expect(accepts(MatterEvent, { ...base, payload })).toBe(true);
    }
  });
});

describe("UI patches — the only thing a model may emit", () => {
  const patch = (operations: unknown[]) => ({ patchId: "p", fromWorkspaceId: "w", operations });
  const card = { id: "a", type: "Card" };

  it("accepts the operations the morph engine implements", () => {
    const ops = [
      { op: "add", parentId: "root", index: 0, component: card },
      { op: "remove", targetId: "a" },
      { op: "replace", targetId: "a", component: card },
      { op: "move", targetId: "a", newParentId: "root", index: 1 },
      { op: "updateProps", targetId: "a", props: { title: "x" } },
      { op: "updateBinding", targetId: "a", bindings: [{ prop: "rows", source: "capability:x:y" }] },
      { op: "focus", targetId: "a" },
      { op: "collapse", targetId: "a" },
      { op: "expand", targetId: "a" },
      { op: "highlight", targetId: "a" },
    ];
    for (const op of ops) expect(accepts(UIPatch, patch([op])), JSON.stringify(op.op)).toBe(true);
  });

  it("refuses an invented operation, a missing target and a missing component", () => {
    expect(accepts(UIPatch, patch([{ op: "explode", targetId: "a" }]))).toBe(false);
    expect(accepts(UIPatch, patch([{ op: "remove" }]))).toBe(false);
    expect(accepts(UIPatch, patch([{ op: "add", parentId: "root", index: 0 }]))).toBe(false);
    expect(accepts(UIPatch, patch([{ op: "move", targetId: "a" }]))).toBe(false);
    expect(accepts(UIPatch, { patchId: "", fromWorkspaceId: "w", operations: [] })).toBe(false);
  });

  it("refuses a component type that is not in the registry, and one without an id", () => {
    expect(accepts(UIComponent, card)).toBe(true);
    expect(accepts(UIComponent, { id: "a", type: "NotARegistryType" })).toBe(false);
    expect(accepts(UIComponent, { type: "Card" })).toBe(false);
    // nesting is checked all the way down
    expect(accepts(UIComponent, { id: "a", type: "Stack", children: [{ id: "b", type: "Nope" }] })).toBe(false);
  });

  it("refuses a blueprint whose schema version is not the one this build speaks", () => {
    expect(accepts(UIBlueprint, emptyBlueprint())).toBe(true);
    expect(accepts(UIBlueprint, { ...emptyBlueprint(), schemaVersion: "9.0.0" })).toBe(false);
    expect(accepts(UIBlueprint, { ...emptyBlueprint(), schemaVersion: 1 })).toBe(false); // a number is not a version
  });
});

function emptyBlueprint() {
  return {
    schemaVersion: UI_SCHEMA_VERSION,
    workspaceId: "ws",
    mode: "development",
    root: { id: "root", type: "Stack", children: [] },
    metadata: { generatedAt: T, decisionId: "d", confidence: 1 },
  };
}

describe("decisions — a model cannot widen its own permissions", () => {
  const decision = {
    id: "d",
    significance: 0.5,
    worldStateUpdates: [],
    capabilityPlan: { capabilities: [] },
    uiPlan: { intent: "surface_incident", targetMode: "incident", confidence: 0.9, reasonSummary: "r" },
    autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
    reasonSummary: "r",
  };

  it("accepts a well-formed decision", () => {
    expect(accepts(RuntimeDecision, decision)).toBe(true);
  });

  it("refuses an invented morph intent", () => {
    expect(accepts(RuntimeDecision, { ...decision, uiPlan: { ...decision.uiPlan, intent: "delete_everything" } })).toBe(false);
  });

  it("refuses out-of-range confidence and significance", () => {
    expect(accepts(RuntimeDecision, { ...decision, uiPlan: { ...decision.uiPlan, confidence: 2 } })).toBe(false);
    expect(accepts(RuntimeDecision, { ...decision, uiPlan: { ...decision.uiPlan, confidence: -0.1 } })).toBe(false);
    expect(accepts(RuntimeDecision, { ...decision, significance: 1.5 })).toBe(false);
  });

  it("refuses an autonomy level or risk that does not exist", () => {
    expect(accepts(RuntimeDecision, { ...decision, autonomyRequirement: { minLevel: 9, requiresApproval: false, risk: "read" } })).toBe(false);
    expect(accepts(RuntimeDecision, { ...decision, autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "yolo" } })).toBe(false);
    expect(accepts(AutonomyLevel, 5)).toBe(false);
    expect(accepts(AutonomyLevel, 2.5)).toBe(false);
    expect(accepts(AutonomyLevel, -1)).toBe(false);
    expect(accepts(RiskLevel, "destructive")).toBe(true);
    expect(accepts(RiskLevel, "kinda risky")).toBe(false);
  });

  it("refuses a decision with no reason a person could read", () => {
    // the body shows this text as "why the interface changed"; an empty one is a silent decision
    expect(accepts(RuntimeDecision, { ...decision, reasonSummary: "" })).toBe(false);
    expect(accepts(RuntimeDecision, { ...decision, uiPlan: { ...decision.uiPlan, reasonSummary: "" } })).toBe(false);
  });
});

describe("world state round-trips through its own schema", () => {
  it("accepts what the runtime produces, and fills the defaults", () => {
    const state = emptyWorldState("s", T);
    const parsed = WorldState.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.behavior.network.failingHosts).toEqual([]);
    expect(state.sensing).toEqual({});
    expect(state.autonomy.level).toBe(2);
  });

  it("refuses a problem without the fields that explain it", () => {
    const state = emptyWorldState("s", T) as unknown as { activeProblems: unknown[] };
    state.activeProblems = [{ id: "p", kind: "runtime_error" }];
    expect(accepts(WorldState, state)).toBe(false);
  });
});
