import { describe, it, expect } from "vitest";
import { parseSimResponse } from "./runtimeClient";
import { describeRisk, riskBadgeClass } from "./risk";
import { describeApprovalReason, missingPermissionNames } from "./approval";
import { describeSensor, describeLayer } from "./sensing";
import { describeHold } from "./hold";
import { describeMorphStep } from "./morphStep";

/**
 * What the server says about an event used to be cast, and everything downstream believed it. The
 * approval card reads a risk and a list of missing permissions straight out of that answer and
 * puts them through helpers that format a name — and a name that is not a string threw inside the
 * render, which in React takes the whole body down rather than one card. Both halves are closed
 * here: the answer is parsed at the boundary, and every helper that formats a name survives one
 * that is not.
 */
const APPROVAL = {
  id: "a1", sessionId: "s", capabilityId: "development.revert_diff", risk: "external_effect",
  reason: "r", createdAt: "2026-09-04T00:00:00Z", status: "pending",
};

describe("an answer from the server", () => {
  it("keeps what it claims to be", () => {
    const parsed = parseSimResponse({
      deliberated: true,
      morph: { applied: true, guardReasonCodes: ["cooldown_active"] },
      pendingApprovals: [APPROVAL],
      patternSuggestions: [{ key: "flow", count: 3 }],
      learned: { suppressed: "stuck", dismissals: 2 },
      retryAfterMs: 1500,
    });
    expect(parsed?.deliberated).toBe(true);
    expect(parsed?.morph).toEqual({ applied: true, guardReasonCodes: ["cooldown_active"] });
    expect(parsed?.pendingApprovals?.[0]?.capabilityId).toBe("development.revert_diff");
    expect(parsed?.patternSuggestions).toEqual([{ key: "flow", count: 3 }]);
    expect(parsed?.learned).toEqual({ suppressed: "stuck", dismissals: 2 });
    expect(parsed?.retryAfterMs).toBe(1500);
  });

  it("is nothing at all when it is not an answer", () => {
    for (const junk of [null, undefined, 42, "ok", [], true]) {
      expect(parseSimResponse(junk), JSON.stringify(junk) ?? "undefined").toBeNull();
    }
  });

  it("is still an answer when it carries nothing", () => {
    expect(parseSimResponse({})).toEqual({});
  });

  it("drops one bad approval and keeps the good ones", () => {
    const parsed = parseSimResponse({ pendingApprovals: [APPROVAL, { id: "half" }, null, "an approval"] });
    expect(parsed?.pendingApprovals?.map((a) => a.id)).toEqual(["a1"]);
  });

  it("does not offer an approval whose risk is not a risk", () => {
    const parsed = parseSimResponse({ pendingApprovals: [{ ...APPROVAL, risk: "catastrophic" }] });
    expect(parsed?.pendingApprovals).toBeUndefined();
  });

  it("fills in a reason code the server did not send, rather than leaving it absent", () => {
    const parsed = parseSimResponse({ pendingApprovals: [APPROVAL] });
    expect(parsed?.pendingApprovals?.[0]?.reasonCode).toBe("risk_above_autonomy");
    expect(parsed?.pendingApprovals?.[0]?.missingPermissions).toEqual([]);
  });

  it("keeps the rest of the answer when one part of it is wrong", () => {
    const parsed = parseSimResponse({ deliberated: true, morph: "applied", pendingApprovals: "none", learned: 7 });
    expect(parsed?.deliberated).toBe(true);
    expect(parsed?.morph).toBeUndefined();
    expect(parsed?.pendingApprovals).toBeUndefined();
    expect(parsed?.learned).toBeUndefined();
  });

  it("takes only the reason codes that are codes", () => {
    const parsed = parseSimResponse({ morph: { applied: false, guardReasonCodes: ["cooldown_active", 7, null, "protects_focus"] } });
    expect(parsed?.morph?.guardReasonCodes).toEqual(["cooldown_active", "protects_focus"]);
  });

  it("treats a morph that does not say it applied as one that did not", () => {
    expect(parseSimResponse({ morph: {} })?.morph).toEqual({ applied: false, guardReasonCodes: [] });
    expect(parseSimResponse({ morph: { applied: "yes" } })?.morph?.applied).toBe(false);
  });

  it("cannot be handed an unbounded list", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({ ...APPROVAL, id: `a${i}` }));
    const parsed = parseSimResponse({
      pendingApprovals: many,
      morph: { applied: true, guardReasonCodes: Array.from({ length: 5_000 }, () => "cooldown_active") },
      patternSuggestions: Array.from({ length: 5_000 }, (_, i) => ({ key: `k${i}`, count: 1 })),
    });
    expect(parsed?.pendingApprovals!.length).toBeLessThanOrEqual(50);
    expect(parsed?.morph!.guardReasonCodes.length).toBeLessThanOrEqual(20);
    expect(parsed?.patternSuggestions!.length).toBeLessThanOrEqual(20);
  });

  it("ignores a retry delay that is not a number of milliseconds", () => {
    for (const bad of ["soon", NaN, Infinity, null]) {
      expect(parseSimResponse({ retryAfterMs: bad })?.retryAfterMs, String(bad)).toBeUndefined();
    }
  });
});

describe("every helper that puts a name on the screen", () => {
  const NOT_NAMES = [undefined, null, 7, {}, [], true, ""] as unknown[];

  it("survives a name that is not one, rather than taking the body down with it", () => {
    for (const value of NOT_NAMES) {
      const label = JSON.stringify(value) ?? "undefined";
      expect(() => describeRisk(value as string, "en"), `describeRisk ${label}`).not.toThrow();
      expect(() => riskBadgeClass(value as string), `riskBadgeClass ${label}`).not.toThrow();
      expect(() => describeSensor(value as string, "en"), `describeSensor ${label}`).not.toThrow();
      expect(() => describeLayer(value as string, "en"), `describeLayer ${label}`).not.toThrow();
      expect(() => describeMorphStep(value as string, "en"), `describeMorphStep ${label}`).not.toThrow();
      expect(() => describeHold(value as string[], "en"), `describeHold ${label}`).not.toThrow();
      expect(() => describeApprovalReason({ reasonCode: value as string }, "en"), `describeApprovalReason ${label}`).not.toThrow();
      expect(() => missingPermissionNames({ missingPermissions: value as string[] }), `missingPermissionNames ${label}`).not.toThrow();
    }
  });

  it("says nothing rather than something wrong", () => {
    for (const value of NOT_NAMES) {
      const label = JSON.stringify(value) ?? "undefined";
      expect(describeRisk(value as string, "en"), `describeRisk ${label}`).toBe("");
      expect(describeSensor(value as string, "en"), `describeSensor ${label}`).toBe("");
      expect(describeLayer(value as string, "en"), `describeLayer ${label}`).toBe("");
      expect(describeMorphStep(value as string, "en"), `describeMorphStep ${label}`).toBe("");
      expect(missingPermissionNames({ missingPermissions: value as string[] }), `missingPermissionNames ${label}`).toEqual([]);
    }
  });

  it("keeps the reasons in a list that are reasons, and drops the rest", () => {
    expect(describeHold(["cooldown_active", 7, null, ""] as unknown as string[], "en")).toBe(describeHold(["cooldown_active"], "en"));
    expect(describeHold([7, null] as unknown as string[], "en")).toBe("");
  });

  it("still gives a badge class for a risk it cannot place", () => {
    for (const value of NOT_NAMES) {
      expect(["badge", "badge warn", "badge crit"], JSON.stringify(value) ?? "undefined").toContain(riskBadgeClass(value as string));
    }
  });
});
