import { describe, it, expect } from "vitest";
import { createRuntimeCore } from "./factory";
import { MAX_APPROVALS } from "@particle/permission-engine";
import type { MatterEvent } from "@particle/contracts";

/**
 * A capability the runtime may not run on its own waits in two places: an approval record the
 * person will answer, and the plan itself — what to run and with what input — held until they do.
 * Those two have to stay in step. The approval store forgets the oldest answered questions at its
 * ceiling, and a plan waiting on one that is gone can never run again.
 */
function makeClock() {
  let n = 0;
  return { iso: () => `2026-09-04T00:00:${String(n % 60).padStart(2, "0")}Z`, ms: () => (n += 1) * 10_000 };
}

const risky = (sessionId: string, id: string): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-09-04T00:00:00Z",
  source: "development",
  type: "security.vulnerability_detected",
  severity: "critical",
  payload: {},
});

describe("a capability waiting for consent", () => {
  it("is offered, and runs once the person says yes", async () => {
    const core = createRuntimeCore(makeClock());
    const result = await core.ingest(risky("s", "e1"));
    const pending = result.pendingApprovals;
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]?.risk).toBe("external_effect");
    expect(pending[0]?.sessionId).toBe("s");

    const outcome = await core.approve(pending[0]!.id);
    expect(outcome).not.toBeNull();
    expect(outcome?.sessionId).toBe("s");
    expect(outcome?.result.ok).toBe(true);
  });

  it("runs once, however many times the answer is given", async () => {
    const core = createRuntimeCore(makeClock());
    const id = (await core.ingest(risky("s", "e1"))).pendingApprovals[0]!.id;
    expect(await core.approve(id)).not.toBeNull();
    expect(await core.approve(id)).toBeNull();
  });

  it("does not run when the person says no, and cannot be run afterwards", async () => {
    const core = createRuntimeCore(makeClock());
    const id = (await core.ingest(risky("s", "e1"))).pendingApprovals[0]!.id;
    expect(core.reject(id)?.status).toBe("rejected");
    expect(await core.approve(id)).toBeNull();
    expect(core.approvals.get(id)).toBeUndefined(); // dropped, so the situation can be offered again
  });

  it("says nothing for an approval id nobody issued", async () => {
    const core = createRuntimeCore(makeClock());
    expect(await core.approve("appr-made-up")).toBeNull();
    expect(core.reject("appr-made-up")).toBeUndefined();
  });
});

describe("questions nobody ever answers", () => {
  it("keeps the plans in step with the approvals, rather than holding them for ever", async () => {
    // each plan holds the input it would run with; without this they accumulate for the life of
    // the process, long after the approval they wait on has been forgotten
    const core = createRuntimeCore(makeClock());
    for (let i = 0; i < MAX_APPROVALS + 200; i += 1) await core.ingest(risky(`s${i}`, `e${i}`));

    expect(core.approvals.list()).toHaveLength(MAX_APPROVALS);
    const oldest = "appr-s0-dec-e0-security.update_dependency";
    expect(core.approvals.get(oldest)).toBeUndefined();
    expect(await core.approve(oldest)).toBeNull();
  });

  it("still runs a recent one after all that", async () => {
    const core = createRuntimeCore(makeClock());
    for (let i = 0; i < MAX_APPROVALS + 50; i += 1) await core.ingest(risky(`s${i}`, `e${i}`));
    const recent = core.approvals.list().at(-1)!;
    const outcome = await core.approve(recent.id);
    expect(outcome).not.toBeNull();
    expect(outcome?.result.ok).toBe(true);
  });

  it("keeps each session's waiting question to itself", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(risky("alpha", "a1"));
    await core.ingest(risky("beta", "b1"));
    expect(core.approvalsFor("alpha").every((a) => a.sessionId === "alpha")).toBe(true);
    expect(core.approvalsFor("beta")).toHaveLength(1);
    expect(core.approvalsFor("never-asked")).toEqual([]);
  });
});
