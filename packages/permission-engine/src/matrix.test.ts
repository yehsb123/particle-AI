import { describe, it, expect } from "vitest";
import type { AutonomyLevel, RiskLevel } from "@particle/contracts";
import { canAutoRun, classify } from "./autonomy";
import { evaluatePlan } from "./permission";
import { ApprovalStore } from "./approvals";

/**
 * This is the safety table the whole product leans on: what may run by itself at each autonomy
 * level. The existing suite spot-checks a few cells; this one pins ALL twenty, so a future edit
 * to the rules has to change a test on purpose rather than by accident.
 */
const LEVELS: AutonomyLevel[] = [0, 1, 2, 3, 4];
const RISKS: RiskLevel[] = ["read", "safe_write", "external_effect", "destructive"];

// rows are risks, columns are L0..L4
const EXPECTED: Record<RiskLevel, ReturnType<typeof classify>[]> = {
  read: ["denied", "denied", "authorized", "authorized", "authorized"],
  safe_write: ["denied", "denied", "needs_approval", "authorized", "authorized"],
  external_effect: ["denied", "denied", "needs_approval", "needs_approval", "authorized"],
  destructive: ["denied", "denied", "needs_approval", "needs_approval", "needs_approval"],
};

describe("autonomy matrix — all 20 cells", () => {
  it("classifies every risk at every level exactly as the policy documents", () => {
    const table = RISKS.map((risk) => LEVELS.map((level) => classify(risk, level)));
    expect(table).toEqual(RISKS.map((risk) => EXPECTED[risk]));
  });

  it("auto-run agrees with the classification everywhere", () => {
    for (const risk of RISKS) {
      for (const level of LEVELS) {
        expect(canAutoRun(risk, level), `${risk}@L${level}`).toBe(classify(risk, level) === "authorized");
      }
    }
  });

  it("never auto-runs a destructive capability, at any level", () => {
    expect(LEVELS.filter((l) => canAutoRun("destructive", l))).toEqual([]);
  });

  it("below adaptive level the AI cannot even ask — nothing reaches approval", () => {
    for (const level of [0, 1] as AutonomyLevel[]) {
      expect(RISKS.map((r) => classify(r, level))).toEqual(["denied", "denied", "denied", "denied"]);
    }
  });

  it("raising the level never takes away a permission (monotonic)", () => {
    const rank = { denied: 0, needs_approval: 1, authorized: 2 } as const;
    for (const risk of RISKS) {
      const ranks = LEVELS.map((l) => rank[classify(risk, l)]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe("evaluatePlan — the split the runtime acts on", () => {
  const plan = [
    { capabilityId: "development.read_logs", risk: "read" as RiskLevel },
    { capabilityId: "memory.store", risk: "safe_write" as RiskLevel },
    { capabilityId: "security.update_dependency", risk: "external_effect" as RiskLevel },
    { capabilityId: "system.wipe", risk: "destructive" as RiskLevel },
  ];

  it("sorts the same plan differently at each level, and always accounts for every item", () => {
    for (const level of LEVELS) {
      const out = evaluatePlan(plan, level);
      expect(out.authorized.length + out.needsApproval.length + out.denied.length).toBe(plan.length);
      expect(out.verdicts).toHaveLength(plan.length);
      expect(out.verdicts.map((v) => v.outcome)).toEqual(plan.map((p) => classify(p.risk, level)));
    }
    expect(evaluatePlan(plan, 2).authorized.map((i) => i.capabilityId)).toEqual(["development.read_logs"]);
    expect(evaluatePlan(plan, 4).needsApproval.map((i) => i.capabilityId)).toEqual(["system.wipe"]);
    expect(evaluatePlan(plan, 1).denied).toHaveLength(4);
  });

  it("carries a human-readable reason for every verdict", () => {
    const out = evaluatePlan(plan, 3);
    expect(out.verdicts.map((v) => v.reason)).toEqual([
      "read@L3 → authorized",
      "safe_write@L3 → authorized",
      "external_effect@L3 → needs_approval",
      "destructive@L3 → needs_approval",
    ]);
  });

  it("an empty plan is an empty verdict, not an error", () => {
    expect(evaluatePlan([], 4)).toEqual({ authorized: [], needsApproval: [], denied: [], verdicts: [] });
  });

  it("keeps duplicates separate — the same capability twice gets two verdicts", () => {
    const dup = [plan[0]!, plan[0]!];
    expect(evaluatePlan(dup, 2).authorized).toHaveLength(2);
  });
});

describe("ApprovalStore — pending decisions", () => {
  const req = (id: string) => ({ id, capabilityId: "security.update_dependency", risk: "external_effect" as RiskLevel, reason: "r", createdAt: "2026-09-03T00:00:00Z" });

  it("starts pending, then records the human decision without losing the request", () => {
    const store = new ApprovalStore();
    expect(store.create(req("a1")).status).toBe("pending");
    expect(store.approve("a1")?.status).toBe("approved");
    expect(store.get("a1")?.status).toBe("approved");
    expect(store.reject("a1")).toBeUndefined(); // a decision is final — consent cannot be revised into refusal, or back
  });

  it("deletes a rejected request so the situation can be offered again", () => {
    const store = new ApprovalStore();
    store.create(req("a2"));
    store.reject("a2");
    expect(store.delete("a2")).toBe(true);
    expect(store.get("a2")).toBeUndefined();
    expect(store.delete("a2")).toBe(false); // deleting twice is not an error
  });

  it("answers about unknown ids with undefined instead of throwing", () => {
    const store = new ApprovalStore();
    expect(store.get("nope")).toBeUndefined();
    expect(store.approve("nope")).toBeUndefined();
    expect(store.reject("nope")).toBeUndefined();
    expect(store.list()).toEqual([]);
  });
});
