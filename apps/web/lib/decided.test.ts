import { describe, it, expect } from "vitest";
import { RUNTIME_MESSAGE_KINDS, APPROVAL_DECISIONS } from "@particle/contracts";
import { parseServerMessage } from "./runtimeClient";

/**
 * The runtime now tells every body watching a session that a capability it proposed has been
 * decided on. The body has to accept that frame for the card to go — and has to keep refusing
 * everything it did before, since this is the door every socket frame comes through.
 *
 * The union itself is one declaration now, in the contracts. The runtime declared what it sends
 * and the body declared what it accepts, separately, and they had already diverged: a kind one
 * side sends and the other has never heard of is dropped in silence.
 */
const S = "mine";
const frame = (over: Record<string, unknown> = {}) => ({
  kind: "approval_decided",
  sessionId: S,
  approvalId: "appr-mine-d1-security.update_dependency",
  decision: "approved",
  ...over,
});

describe("a frame saying a capability was decided", () => {
  it("is taken, for either answer", () => {
    for (const decision of APPROVAL_DECISIONS) {
      const parsed = parseServerMessage(frame({ decision }), S);
      expect(parsed, decision).not.toBeNull();
      expect(parsed).toMatchObject({ kind: "approval_decided", decision, approvalId: frame().approvalId });
    }
  });

  it("is dropped when it is about another session", () => {
    expect(parseServerMessage(frame({ sessionId: "theirs" }), S)).toBeNull();
  });

  it("is dropped when it does not say which approval", () => {
    for (const approvalId of [undefined, null, "", 7, {}, []]) {
      expect(parseServerMessage(frame({ approvalId }), S), JSON.stringify(approvalId) ?? "undefined").toBeNull();
    }
  });

  it("is dropped when the answer is not one of the answers there are", () => {
    for (const decision of [undefined, null, "maybe", "APPROVED", 1, true, {}]) {
      expect(parseServerMessage(frame({ decision }), S), JSON.stringify(decision) ?? "undefined").toBeNull();
    }
  });
});

const APPROVAL = {
  id: "appr-mine-d1-security.update_dependency",
  sessionId: S,
  capabilityId: "security.update_dependency",
  risk: "external_effect",
  reason: "external_effect capability requires approval at autonomy level 2",
  reasonCode: "risk_above_autonomy",
  missingPermissions: [],
  createdAt: "2026-09-05T00:00:00Z",
  status: "pending",
};
const asked = (over: Record<string, unknown> = {}) => ({ kind: "approval_asked", sessionId: S, approvals: [APPROVAL], ...over });

describe("a frame asking about a capability", () => {
  it("is taken, so a body that did not cause it still gets the card", () => {
    const parsed = parseServerMessage(asked(), S);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ kind: "approval_asked" });
  });

  it("is dropped when it is about another session", () => {
    expect(parseServerMessage(asked({ sessionId: "theirs" }), S)).toBeNull();
  });

  it("is dropped when it carries nothing to draw", () => {
    for (const approvals of [undefined, null, [], "one", {}, [null], [{ id: "half" }]]) {
      expect(parseServerMessage(asked({ approvals }), S), JSON.stringify(approvals) ?? "undefined").toBeNull();
    }
  });

  it("keeps the ones that are approvals and drops the rest", () => {
    const parsed = parseServerMessage(asked({ approvals: [APPROVAL, null, { id: "half" }, 7] }), S);
    expect(parsed).not.toBeNull();
  });

  it("is dropped when an approval says a risk that is not a risk", () => {
    expect(parseServerMessage(asked({ approvals: [{ ...APPROVAL, risk: "catastrophic" }] }), S)).toBeNull();
  });
});

describe("the door every frame comes through", () => {
  it("knows every kind the contracts describe, and nothing else", () => {
    const accepted = new Set<string>();
    const samples: Record<string, unknown>[] = [
      frame(),
      asked(),
      { kind: "ai_presence_changed", sessionId: S, state: "acting" },
      { kind: "decision_created", sessionId: S, audit: [] },
      { kind: "learned", sessionId: S, learned: { suppressed: "stuck", dismissals: 2 } },
      { kind: "pattern_suggestions", sessionId: S, suggestions: [{ key: "flow", count: 3 }] },
    ];
    for (const sample of samples) {
      if (parseServerMessage(sample, S)) accepted.add(String(sample.kind));
    }
    for (const kind of accepted) {
      expect(RUNTIME_MESSAGE_KINDS as readonly string[], kind).toContain(kind);
    }
    expect(accepted.has("approval_decided")).toBe(true);
    expect(accepted.has("approval_asked")).toBe(true);
  });

  it("still refuses a kind nobody declared", () => {
    for (const kind of ["approval_created", "shell_exec", "", "toString", "__proto__"]) {
      expect(parseServerMessage({ kind, sessionId: S, approvalId: "a", decision: "approved" }, S), kind).toBeNull();
    }
  });

  it("still refuses a frame that is not a frame", () => {
    for (const junk of [null, undefined, 42, "approved", [], true, {}]) {
      expect(parseServerMessage(junk, S), JSON.stringify(junk) ?? "undefined").toBeNull();
    }
  });
});
