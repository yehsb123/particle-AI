import { describe, it, expect } from "vitest";
import { ApprovalRequest } from "@particle/contracts";
import { evaluatePlan, ApprovalStore } from "./index";

/**
 * A capability manifest can declare permissions it needs before it may run — an MCP tool declares
 * its server, so that wiring a server in is what allows its tools. Nothing read that declaration:
 * a tool from a server nobody had allowed was judged on its name-inferred risk alone, and
 * `get_secrets` reads as a read, so it ran on its own at the default level 2.
 *
 * The rule is one-directional on purpose. A manifest is written by whoever registered the
 * capability, which for MCP is somebody else's server describing itself, so what it declares can
 * only ever hold it back. The worst a capability can do to itself by declaring is have to ask.
 */
const ungranted = { capabilityId: "mcp.evil.get_secrets", risk: "read" as const, requiredPermissions: ["mcp:evil"] };
const plain = { capabilityId: "memory.recall", risk: "read" as const, requiredPermissions: [] };

describe("a capability that needs a permission nobody granted", () => {
  it("asks instead of running, at every level that would have run it", () => {
    for (const level of [2, 3, 4] as const) {
      expect(evaluatePlan([ungranted], level).verdicts[0]?.outcome, `L${level}`).toBe("needs_approval");
    }
  });

  it("runs once that permission is granted", () => {
    for (const level of [2, 3, 4] as const) {
      expect(evaluatePlan([ungranted], level, ["mcp:evil"]).verdicts[0]?.outcome, `L${level}`).toBe("authorized");
    }
  });

  it("says which permission it is, so the person can answer the question", () => {
    const verdict = evaluatePlan([ungranted], 2).verdicts[0]!;
    expect(verdict.missingPermissions).toEqual(["mcp:evil"]);
    expect(verdict.reason).toContain("mcp:evil");
  });

  it("lands in the bucket a human decides on, not the one that ran", () => {
    const evaluation = evaluatePlan([ungranted], 4);
    expect(evaluation.authorized).toEqual([]);
    expect(evaluation.needsApproval.map((i) => i.capabilityId)).toEqual(["mcp.evil.get_secrets"]);
    expect(evaluation.denied).toEqual([]);
  });

  it("is still denied below the level where the AI may act at all", () => {
    // a grant is not a way around a passive autonomy level
    for (const level of [0, 1] as const) {
      expect(evaluatePlan([ungranted], level, ["mcp:evil"]).verdicts[0]?.outcome, `L${level}`).toBe("denied");
    }
  });

  it("never turns a refusal into consent, whatever it declares", () => {
    const destructive = { capabilityId: "c", risk: "destructive" as const, requiredPermissions: [] };
    expect(evaluatePlan([destructive], 4, ["everything"]).verdicts[0]?.outcome).toBe("needs_approval");
    expect(evaluatePlan([{ ...destructive, requiredPermissions: ["mcp:x"] }], 4, ["mcp:x"]).verdicts[0]?.outcome).toBe("needs_approval");
  });
});

describe("a capability that declares nothing", () => {
  it("is judged exactly as it was before any of this", () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      const declared = evaluatePlan([plain], level).verdicts[0]!;
      const silent = evaluatePlan([{ capabilityId: plain.capabilityId, risk: plain.risk }], level).verdicts[0]!;
      expect(declared.outcome, `L${level}`).toBe(silent.outcome);
      expect(declared.missingPermissions, `L${level}`).toEqual([]);
    }
  });

  it("is unaffected by what has been granted to anything else", () => {
    expect(evaluatePlan([plain], 2, ["mcp:evil", "mcp:other"]).verdicts[0]?.outcome).toBe("authorized");
  });
});

describe("what a manifest can declare", () => {
  it("is not trusted to be a readable name", () => {
    // a blank permission is one we cannot check, which is not one we have
    for (const declared of [[""], ["   "], [null as unknown as string]]) {
      expect(evaluatePlan([{ ...plain, requiredPermissions: declared }], 2).verdicts[0]?.outcome, JSON.stringify(declared)).toBe("needs_approval");
    }
  });

  it("cannot reach past the grants it is checked against", () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      expect(evaluatePlan([{ ...plain, requiredPermissions: [name] }], 2).verdicts[0]?.outcome, name).toBe("needs_approval");
      expect(evaluatePlan([{ ...plain, requiredPermissions: [name] }], 2, [name]).verdicts[0]?.outcome, name).toBe("authorized");
    }
  });

  it("cannot fill the reason with as many names as it likes", () => {
    const many = Array.from({ length: 500 }, (_, i) => `p${i}`);
    const verdict = evaluatePlan([{ ...plain, requiredPermissions: many }], 2).verdicts[0]!;
    expect(verdict.outcome).toBe("needs_approval");
    expect(verdict.missingPermissions.length).toBeLessThanOrEqual(3);
    expect(verdict.reason.length).toBeLessThan(200);
  });

  it("is not doubled up when it names the same one twice", () => {
    expect(evaluatePlan([{ ...plain, requiredPermissions: ["mcp:x", "mcp:x"] }], 2).verdicts[0]?.missingPermissions).toEqual(["mcp:x"]);
  });
});

describe("the request a person is shown", () => {
  const store = () => new ApprovalStore();

  it("carries the reason as something the body can put words to", () => {
    const req = store().create({
      id: "a", sessionId: "s", capabilityId: "mcp.evil.get_secrets", risk: "read",
      reason: "capability needs a permission that has not been granted: mcp:evil",
      reasonCode: "permission_not_granted", missingPermissions: ["mcp:evil"],
      createdAt: "2026-09-04T00:00:00Z",
    });
    expect(req.reasonCode).toBe("permission_not_granted");
    expect(req.missingPermissions).toEqual(["mcp:evil"]);
    expect(ApprovalRequest.safeParse(req).success).toBe(true);
  });

  it("blames the autonomy level only when that is what stopped it", () => {
    const req = store().create({
      id: "a", sessionId: "s", capabilityId: "shell.run", risk: "destructive",
      reason: "destructive capability requires approval at autonomy level 4",
      createdAt: "2026-09-04T00:00:00Z",
    });
    expect(req.reasonCode).toBe("risk_above_autonomy");
    expect(req.missingPermissions).toEqual([]);
  });

  it("keeps its own copy of the names it was given", () => {
    const missing = ["mcp:evil"];
    const s = store();
    s.create({ id: "a", sessionId: "s", capabilityId: "c", risk: "read", reason: "r", missingPermissions: missing, createdAt: "2026-09-04T00:00:00Z" });
    missing.push("mcp:sneaked-in");
    expect(s.get("a")?.missingPermissions).toEqual(["mcp:evil"]);
  });

  it("is read back from a record written before it had a reason code", () => {
    const older = { id: "a", sessionId: "s", capabilityId: "c", risk: "read", reason: "r", createdAt: "2026-09-04T00:00:00Z", status: "pending" };
    const parsed = ApprovalRequest.safeParse(older);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reasonCode).toBe("risk_above_autonomy");
      expect(parsed.data.missingPermissions).toEqual([]);
    }
  });

  it("is refused when the reason is not one of the reasons there are", () => {
    const bad = { id: "a", sessionId: "s", capabilityId: "c", risk: "read", reason: "r", reasonCode: "because", createdAt: "2026-09-04T00:00:00Z", status: "pending" };
    expect(ApprovalRequest.safeParse(bad).success).toBe(false);
  });
});
