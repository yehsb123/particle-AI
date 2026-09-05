import { describe, it, expect } from "vitest";
import { RuntimeDecision, UIMorphPlan, CapabilityPlan, MAX_IDENTIFIER, MAX_PLANNED_CAPABILITIES } from "./index";

/**
 * The reason summary was one field of a family. Every other string a model writes into a decision
 * was still asked only not to be empty, and each of them is kept somewhere:
 *
 *   variant     composes a preference key that is stored, snapshotted and shown in the memory tab,
 *               and composes the learned notice the body renders as a line of text
 *   targetMode  is written into the blueprint as the mode the workspace is in
 *   capabilityId is what the runtime looks up and runs
 *
 * A model could write fifty thousand characters, or an escape sequence, into any of them, and a
 * plan could name five hundred capabilities the runtime would then run one after another.
 *
 * Names are trimmed and cleaned; a plan that is not a handful is refused outright. The difference
 * is deliberate: shortening a caption still describes the same decision, while dropping half the
 * capabilities would run a plan the model never reasoned about, and a refused decision falls back
 * to the deterministic one.
 */
const ESC = "\u001b";
const base = {
  id: "d1",
  significance: 0.9,
  capabilityPlan: { capabilities: [] },
  autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
  reasonSummary: "a reason",
};
const withPlan = (over: Record<string, unknown>) => ({
  ...base,
  uiPlan: { intent: "augment", targetMode: "development", confidence: 0.9, reasonSummary: "a reason", ...over },
});
const plan = (over: Record<string, unknown>) => {
  const parsed = RuntimeDecision.safeParse(withPlan(over));
  return parsed.success ? parsed.data.uiPlan : undefined;
};

describe("a name a model wrote", () => {
  it("is kept as written when it is a name", () => {
    expect(plan({ variant: "stuck" })?.variant).toBe("stuck");
    expect(plan({ targetMode: "incident" })?.targetMode).toBe("incident");
  });

  it("is cut when it is long enough to be prose", () => {
    for (const field of ["variant", "targetMode"] as const) {
      const value = plan({ [field]: "v".repeat(50_000) })?.[field];
      expect(value!.length, field).toBe(MAX_IDENTIFIER + 1);
      expect(value!.endsWith("…"), field).toBe(true);
    }
  });

  it("carries none of the characters that are not writing", () => {
    expect(plan({ variant: `${ESC}[31mstuck` })?.variant).toBe("[31mstuck");
    expect(plan({ targetMode: `dev${ESC}[0m` })?.targetMode).toBe("dev[0m");
  });

  it("is refused when nothing readable is left of it", () => {
    // a name is what the runtime looks something up by; one made only of characters that cannot
    // be shown is not a name
    expect(plan({ variant: ESC })).toBeUndefined();
    expect(plan({ targetMode: ESC })).toBeUndefined();
    expect(plan({ targetMode: "" })).toBeUndefined();
  });

  it("keeps the rest of the decision standing when the name was merely long", () => {
    const parsed = RuntimeDecision.safeParse(withPlan({ variant: "v".repeat(50_000) }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.id).toBe("d1");
  });
});

describe("what the runtime composes from that name", () => {
  it("is a key and a notice someone could read", () => {
    const variant = plan({ variant: "v".repeat(50_000) })!.variant!;
    // the preference key is stored and snapshotted; the notice is rendered as a line of text
    expect(`dismissed:augment:${variant}`.length).toBeLessThan(MAX_IDENTIFIER + 40);
    expect(`augment:${variant}`.length).toBeLessThan(MAX_IDENTIFIER + 20);
  });
});

describe("the capability a plan names", () => {
  const capabilities = (list: unknown[]) => CapabilityPlan.safeParse({ capabilities: list });

  it("is kept as written when it is an id", () => {
    const parsed = capabilities([{ capabilityId: "development.read_logs" }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.capabilities[0]!.capabilityId).toBe("development.read_logs");
  });

  it("is cut when it is long enough to be prose", () => {
    const parsed = capabilities([{ capabilityId: "c".repeat(50_000) }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.capabilities[0]!.capabilityId.length).toBe(MAX_IDENTIFIER + 1);
  });

  it("is a handful, or the plan is refused rather than half-run", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ capabilityId: `c${i}` }));
    expect(capabilities(many(MAX_PLANNED_CAPABILITIES)).success).toBe(true);
    expect(capabilities(many(MAX_PLANNED_CAPABILITIES + 1)).success).toBe(false);
    expect(capabilities(many(500)).success).toBe(false);
  });

  it("is nothing at all when a plan asks for nothing", () => {
    const parsed = capabilities([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.capabilities).toEqual([]);
  });
});

describe("the plan a model hands back whole", () => {
  it("is what a real one looks like", () => {
    const parsed = RuntimeDecision.safeParse({
      ...base,
      capabilityPlan: { capabilities: [{ capabilityId: "development.read_logs" }] },
      uiPlan: { intent: "surface_incident", targetMode: "incident", confidence: 0.9, reasonSummary: "a reason", variant: "runtime_error" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.uiPlan!.variant).toBe("runtime_error");
      expect(parsed.data.capabilityPlan.capabilities[0]!.capabilityId).toBe("development.read_logs");
    }
  });

  it("is refused when the plan itself is not one", () => {
    expect(UIMorphPlan.safeParse({ intent: "flourish", targetMode: "x", confidence: 0.5, reasonSummary: "r" }).success).toBe(false);
    expect(UIMorphPlan.safeParse({ intent: "augment", targetMode: "x", confidence: 7, reasonSummary: "r" }).success).toBe(false);
  });
});
