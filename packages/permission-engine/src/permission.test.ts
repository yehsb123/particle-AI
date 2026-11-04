import { describe, it, expect } from "vitest";
import { canAutoRun, classify } from "./autonomy";
import { evaluatePlan } from "./permission";
import { ApprovalStore } from "./approvals";
import { AuditLog } from "./audit";

describe("autonomy rules", () => {
  it("gates auto-run by risk and level", () => {
    expect(canAutoRun("read", 2)).toBe(true);
    expect(canAutoRun("read", 1)).toBe(false);
    expect(canAutoRun("safe_write", 2)).toBe(false);
    expect(canAutoRun("safe_write", 3)).toBe(true);
    expect(canAutoRun("external_effect", 4)).toBe(true);
    expect(canAutoRun("destructive", 4)).toBe(false); // never auto in MVP
  });

  it("classifies outcomes", () => {
    expect(classify("read", 1)).toBe("denied");
    expect(classify("read", 2)).toBe("authorized");
    expect(classify("safe_write", 2)).toBe("needs_approval");
    expect(classify("destructive", 2)).toBe("needs_approval");
    expect(classify("external_effect", 0)).toBe("denied");
  });
});

describe("evaluatePlan", () => {
  it("splits a plan into authorized / needs-approval / denied at level 2", () => {
    const res = evaluatePlan(
      [
        { capabilityId: "development.read_logs", risk: "read" },
        { capabilityId: "memory.store", risk: "safe_write" },
        { capabilityId: "fs.delete", risk: "destructive" },
      ],
      2,
    );
    expect(res.authorized.map((i) => i.capabilityId)).toEqual(["development.read_logs"]);
    expect(res.needsApproval.map((i) => i.capabilityId)).toEqual(["memory.store", "fs.delete"]);
    expect(res.denied).toHaveLength(0);
  });
});

describe("ApprovalStore", () => {
  it("creates, approves and rejects", () => {
    const store = new ApprovalStore();
    const req = store.create({ id: "a1", sessionId: "s", capabilityId: "x", risk: "external_effect", reason: "r", createdAt: "2026-01-01T00:00:00Z" });
    expect(req.status).toBe("pending");
    expect(store.approve("a1")?.status).toBe("approved");
    const r2 = store.create({ id: "a2", sessionId: "s", capabilityId: "y", risk: "destructive", reason: "r", createdAt: "2026-01-01T00:00:00Z" });
    expect(store.reject(r2.id)?.status).toBe("rejected");
  });
});

describe("AuditLog", () => {
  it("appends and filters by session", () => {
    const log = new AuditLog();
    log.append({ id: "1", at: "2026-01-01T00:00:00Z", sessionId: "s1", kind: "decision", detail: {} });
    log.append({ id: "2", at: "2026-01-01T00:00:01Z", sessionId: "s2", kind: "morph", detail: {} });
    expect(log.count()).toBe(2);
    expect(log.list("s1")).toHaveLength(1);
  });

  /**
   * The trail is append-only, and the approval store beside it already hands out copies for the
   * same reason: a record a reader can reach into is a record of whatever that reader last
   * decided it should say. A trail that can be rewritten after the fact answers no question.
   */
  it("hands out copies, so a reader cannot rewrite what was recorded", () => {
    const log = new AuditLog();
    const appended = log.append({ id: "1", at: "2026-01-01T00:00:00Z", sessionId: "s1", kind: "decision", detail: { approved: false } });
    appended.kind = "rewritten-through-the-return-value";

    const listed = log.list();
    listed[0]!.kind = "rewritten-through-list";
    listed[0]!.detail.approved = true;
    listed.push({ id: "forged", at: "2026-01-01T00:00:02Z", sessionId: "s1", kind: "forged", detail: {} });

    const filtered = log.list("s1");
    filtered[0]!.sessionId = "somebody-else";

    expect(log.count()).toBe(1);
    expect(log.list()).toHaveLength(1);
    expect(log.list()[0]).toMatchObject({ id: "1", kind: "decision", sessionId: "s1", detail: { approved: false } });
  });

  /**
   * `detail` is a record of anything, and what the runtime puts in it is the patch it applied,
   * the verdicts it reached, the capabilities it ran — nested, not flat. A copy one layer deep
   * leaves all of that reachable, so the trail still says whatever the last reader decided.
   */
  it("copies what is inside detail too, not just the record around it", () => {
    const log = new AuditLog();
    const detail = { patch: { ops: ["add"] }, verdicts: [{ capabilityId: "x", outcome: "needs_approval" }] };
    log.append({ id: "1", at: "2026-01-01T00:00:00Z", sessionId: "s1", kind: "morph", detail });

    detail.patch.ops.push("rewritten-through-the-caller's-own-object");
    const listed = log.list()[0]!.detail as typeof detail;
    listed.patch.ops.push("rewritten-through-list");
    listed.verdicts[0]!.outcome = "authorized";

    expect(log.list()[0]?.detail).toEqual({
      patch: { ops: ["add"] },
      verdicts: [{ capabilityId: "x", outcome: "needs_approval" }],
    });
  });
});
