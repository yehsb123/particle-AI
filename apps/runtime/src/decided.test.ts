import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";
import { RUNTIME_MESSAGE_KINDS, type RuntimeMessage } from "@particle/contracts";

/**
 * A capability the runtime proposes waits on a person, and the answer used to go nowhere.
 *
 * One body asking is not the only body watching. The same session is open in another tab and in
 * the extension's side panel, and whichever one did not click kept a card for something already
 * settled — clicking it got a 404 and no explanation. Undo, next to these in the same file, told
 * every watcher all along.
 *
 * The refusal was worse: it left no trace at all. The trail recorded what a person allowed and
 * kept nothing of what they turned down, which is the half of a consent record worth having.
 */
let app: FastifyInstance;
let runtime: SessionRuntime;
let heard: RuntimeMessage[];

beforeEach(async () => {
  ({ app, runtime } = await buildServer());
  await app.ready();
  heard = [];
  runtime.onMessage((m) => heard.push(m));
});
afterEach(async () => {
  await app.close();
});

/** Open a session whose vulnerability makes the runtime propose a risky remediation. */
const pendingIn = async (session: string): Promise<{ id: string; capabilityId: string }> => {
  const r = await app.inject({ method: "POST", url: `/api/sim/${session}/vuln` });
  const pending = r.json().pendingApprovals ?? [];
  expect(pending.length, session).toBeGreaterThan(0);
  return pending[0];
};

const decisions = () => heard.filter((m): m is Extract<RuntimeMessage, { kind: "approval_decided" }> => m.kind === "approval_decided");
const auditOf = async (session: string) =>
  ((await app.inject({ method: "GET", url: `/api/sessions/${session}/decisions` })).json().audit ?? []) as { kind: string; sessionId: string; detail: Record<string, unknown> }[];

describe("a capability the runtime is asking about", () => {
  it("is put to every body watching that session, not only the one whose event caused it", async () => {
    heard.length = 0;
    const approval = await pendingIn("asked");
    const asked = heard.filter((m): m is Extract<RuntimeMessage, { kind: "approval_asked" }> => m.kind === "approval_asked");

    expect(asked).toHaveLength(1);
    expect(asked[0]!.sessionId).toBe("asked");
    expect(asked[0]!.approvals.map((a) => a.id)).toContain(approval.id);
  });

  it("carries what a body needs to draw the card", async () => {
    heard.length = 0;
    await pendingIn("card");
    const asked = heard.find((m) => m.kind === "approval_asked") as Extract<RuntimeMessage, { kind: "approval_asked" }>;
    const offered = asked.approvals[0]!;
    expect(offered.capabilityId.length).toBeGreaterThan(0);
    expect(offered.risk).toBe("external_effect");
    expect(offered.status).toBe("pending");
    expect(offered.sessionId).toBe("card");
    expect(typeof offered.reasonCode).toBe("string");
  });

  it("is put only to bodies watching that session", async () => {
    await pendingIn("theirs2");
    heard.length = 0;
    await pendingIn("mine2");
    const asked = heard.filter((m) => m.kind === "approval_asked");
    expect(asked.map((m) => m.sessionId)).toEqual(["mine2"]);
  });

  it("is not asked when nothing needs asking about", async () => {
    heard.length = 0;
    await app.inject({ method: "POST", url: "/api/sim/quiet2/open-file" });
    expect(heard.some((m) => m.kind === "approval_asked")).toBe(false);
  });

  it("goes out with the presence that says the runtime is waiting", async () => {
    // the presence reached every body all along; the card did not, so they showed a runtime
    // waiting on somebody with nothing to answer it with
    heard.length = 0;
    await pendingIn("both");
    const kinds = heard.map((m) => m.kind);
    expect(kinds).toContain("ai_presence_changed");
    expect(kinds).toContain("approval_asked");
  });
});

describe("a capability someone allowed", () => {
  it("is told to every body watching that session", async () => {
    const approval = await pendingIn("told-approve");
    heard.length = 0;
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });

    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ sessionId: "told-approve", approvalId: approval.id, decision: "approved" });
  });

  it("is told about in that session and no other", async () => {
    const approval = await pendingIn("mine");
    await pendingIn("theirs");
    heard.length = 0;
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });
    expect(decisions().map((m) => m.sessionId)).toEqual(["mine"]);
  });

  it("is still recorded as approved", async () => {
    const approval = await pendingIn("kept-approve");
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });
    const audit = await auditOf("kept-approve");
    expect(audit.map((r) => r.kind)).toContain("capability_approved");
  });
});

describe("a capability someone turned down", () => {
  it("is told to every body watching that session", async () => {
    const approval = await pendingIn("told-reject");
    heard.length = 0;
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/reject` });

    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ sessionId: "told-reject", approvalId: approval.id, decision: "rejected" });
  });

  it("is written into the trail, which used to keep only what was allowed", async () => {
    const approval = await pendingIn("kept-reject");
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/reject` });

    const record = (await auditOf("kept-reject")).find((r) => r.kind === "capability_rejected");
    expect(record).toBeDefined();
    expect(record!.sessionId).toBe("kept-reject");
    expect(record!.detail.capabilityId).toBe(approval.capabilityId);
    expect(record!.detail.approvalId).toBe(approval.id);
  });

  it("says what was turned down, not just that something was", async () => {
    const approval = await pendingIn("what-reject");
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/reject` });
    const record = (await auditOf("what-reject")).find((r) => r.kind === "capability_rejected")!;
    expect(record.detail.risk).toBe("external_effect");
  });

  it("does not run the capability it turned down", async () => {
    const approval = await pendingIn("not-run");
    const r = await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/reject` });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("lodash");
    const audit = await auditOf("not-run");
    expect(audit.map((x) => x.kind)).not.toContain("capability_approved");
  });
});

describe("an answer that decides nothing", () => {
  it("tells nobody anything, for an id that was never asked about", async () => {
    heard.length = 0;
    for (const url of ["/api/approvals/appr-nope/approve", "/api/approvals/appr-nope/reject"]) {
      expect((await app.inject({ method: "POST", url })).statusCode, url).toBe(404);
    }
    expect(decisions()).toEqual([]);
  });

  it("tells nobody twice, when the same one is answered again", async () => {
    const approval = await pendingIn("twice");
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });
    heard.length = 0;
    const again = await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });
    expect(again.statusCode).toBe(404);
    expect(decisions()).toEqual([]);
  });
});

describe("the vocabulary both sides read", () => {
  it("holds every kind the runtime actually sends", async () => {
    const approval = await pendingIn("vocab");
    await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/approve` });
    await app.inject({ method: "POST", url: "/api/sim/vocab2/http-500" });
    await app.inject({ method: "POST", url: "/api/morph/vocab2/undo", payload: {} });

    expect(heard.length).toBeGreaterThan(0);
    for (const m of heard) {
      expect(RUNTIME_MESSAGE_KINDS as readonly string[], m.kind).toContain(m.kind);
    }
  });

  it("names a session on every frame, so a body can tell whether it is theirs", () => {
    for (const m of heard) expect(typeof m.sessionId, m.kind).toBe("string");
  });
});
