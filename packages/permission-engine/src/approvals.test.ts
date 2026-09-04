import { describe, it, expect } from "vitest";
import type { RiskLevel } from "@particle/contracts";
import { ApprovalStore, MAX_APPROVALS } from "./approvals";

/**
 * An approval is a person's answer to "may I do this?", and it is the only thing standing in
 * front of an action that changes the world outside the runtime. So it has to be impossible to
 * turn a refusal into consent, impossible to rewrite one from outside, and impossible for a
 * long-running process to drop a question nobody has answered yet just because it got busy.
 */
const req = (id: string, over: Partial<{ capabilityId: string; risk: RiskLevel; reason: string; createdAt: string }> = {}) => ({
  id,
  capabilityId: "security.update_dependency",
  risk: "external_effect" as RiskLevel,
  reason: "updates a vulnerable dependency",
  createdAt: "2026-09-04T00:00:00Z",
  ...over,
});

describe("asking", () => {
  it("starts pending, carrying what is being asked and why", () => {
    const store = new ApprovalStore();
    const created = store.create(req("a1"));
    expect(created.status).toBe("pending");
    expect(created.capabilityId).toBe("security.update_dependency");
    expect(created.risk).toBe("external_effect");
    expect(created.reason.length).toBeGreaterThan(0);
    expect(store.get("a1")).toEqual(created);
  });

  it("lists what is waiting, and says nothing about ids it never saw", () => {
    const store = new ApprovalStore();
    store.create(req("a1"));
    store.create(req("a2"));
    expect(store.list().map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(store.get("never")).toBeUndefined();
    expect(store.approve("never")).toBeUndefined();
    expect(store.reject("never")).toBeUndefined();
    expect(store.delete("never")).toBe(false);
  });

  it("replaces a request asked again under the same id, still pending", () => {
    const store = new ApprovalStore();
    store.create(req("a1", { reason: "first" }));
    expect(store.create(req("a1", { reason: "second" })).reason).toBe("second");
    expect(store.list()).toHaveLength(1);
    expect(store.get("a1")?.status).toBe("pending");
  });
});

describe("answering", () => {
  it("records consent and refusal", () => {
    const store = new ApprovalStore();
    store.create(req("yes"));
    store.create(req("no"));
    expect(store.approve("yes")?.status).toBe("approved");
    expect(store.reject("no")?.status).toBe("rejected");
    expect(store.get("yes")?.status).toBe("approved");
    expect(store.get("no")?.status).toBe("rejected");
  });

  it("treats a decision as final", () => {
    // nothing may turn a refusal into consent, or consent into a refusal, after the fact
    const store = new ApprovalStore();
    store.create(req("a1"));
    store.reject("a1");
    expect(store.approve("a1")).toBeUndefined();
    expect(store.get("a1")?.status).toBe("rejected");

    store.create(req("a2"));
    store.approve("a2");
    expect(store.reject("a2")).toBeUndefined();
    expect(store.get("a2")?.status).toBe("approved");
  });

  it("gives back the answer that stands when asked the same way twice", () => {
    const store = new ApprovalStore();
    store.create(req("a1"));
    expect(store.approve("a1")?.status).toBe("approved");
    expect(store.approve("a1")?.status).toBe("approved");
    expect(store.list()).toHaveLength(1);
  });

  it("lets a refused request be dropped so the same situation can be offered again", () => {
    const store = new ApprovalStore();
    store.create(req("a1"));
    store.reject("a1");
    expect(store.delete("a1")).toBe(true);
    expect(store.get("a1")).toBeUndefined();
    expect(store.create(req("a1")).status).toBe("pending"); // asked again, cleanly
  });
});

describe("what a reader gets", () => {
  it("hands out copies, so a permission record cannot be rewritten from outside", () => {
    const store = new ApprovalStore();
    store.create(req("a1"));

    const listed = store.list();
    listed[0]!.status = "approved";
    listed.push(req("forged") as never);
    expect(store.get("a1")?.status).toBe("pending");
    expect(store.list()).toHaveLength(1);

    const got = store.get("a1")!;
    got.status = "approved";
    got.capabilityId = "something.else";
    expect(store.get("a1")).toMatchObject({ status: "pending", capabilityId: "security.update_dependency" });

    const created = store.create(req("a2"));
    created.status = "approved";
    expect(store.get("a2")?.status).toBe("pending");
  });
});

describe("a process that runs for weeks", () => {
  it("stays bounded instead of keeping every request ever made", () => {
    const store = new ApprovalStore();
    for (let i = 0; i < MAX_APPROVALS + 50; i += 1) {
      store.create(req(`a${i}`));
      store.approve(`a${i}`);
    }
    expect(store.list()).toHaveLength(MAX_APPROVALS);
    expect(store.get("a0")).toBeUndefined();
    expect(store.get(`a${MAX_APPROVALS + 49}`)).toBeDefined();
  });

  it("forgets an answered request before an unanswered one", () => {
    // a pending approval is a question someone has not answered yet; losing it silently is worse
    // than forgetting an answer already given
    const store = new ApprovalStore();
    for (let i = 0; i < 5; i += 1) store.create(req(`waiting${i}`));
    for (let i = 0; i < MAX_APPROVALS; i += 1) {
      store.create(req(`done${i}`));
      store.approve(`done${i}`);
    }
    const left = store.list();
    expect(left).toHaveLength(MAX_APPROVALS);
    for (let i = 0; i < 5; i += 1) expect(store.get(`waiting${i}`)?.status, `waiting${i}`).toBe("pending");
    expect(store.get("done0")).toBeUndefined(); // the oldest answered one went first
  });

  it("gives up the oldest question only when nothing answered is left to forget", () => {
    const store = new ApprovalStore();
    for (let i = 0; i < MAX_APPROVALS + 2; i += 1) store.create(req(`p${i}`));
    expect(store.list()).toHaveLength(MAX_APPROVALS);
    expect(store.get("p0")).toBeUndefined();
    expect(store.get("p1")).toBeUndefined();
    expect(store.get(`p${MAX_APPROVALS + 1}`)?.status).toBe("pending");
  });

  it("does not evict anything when the same id is asked again at the cap", () => {
    const store = new ApprovalStore();
    for (let i = 0; i < MAX_APPROVALS; i += 1) store.create(req(`p${i}`));
    store.create(req("p0", { reason: "asked again" }));
    expect(store.list()).toHaveLength(MAX_APPROVALS);
    expect(store.get("p0")?.reason).toBe("asked again");
  });
});
