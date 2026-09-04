import { describe, it, expect } from "vitest";
import {
  ApprovalRequest,
  AttentionState,
  AuditRecord,
  CapabilityManifest,
  CapabilityResult,
  CapabilityRun,
  EMPTY_ATTENTION,
  IntelligenceRequest,
  ModelCapability,
  ModelTier,
  RiskLevel,
} from "./index";

/**
 * The rest of the vocabulary: what a capability declares about itself, what an approval and an
 * audit record must carry, what the interface says about the person's attention, and what a
 * request to a brain looks like. These are the shapes every package agrees on, so what they
 * refuse is what keeps the packages honest with each other.
 */
const T = "2026-09-04T00:00:00Z";
const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("what a capability declares about itself", () => {
  const manifest = {
    id: "development.read_logs",
    name: "Read runtime logs",
    description: "",
    risk: "read",
    latencyClass: "instant",
    costClass: "free",
  };

  it("accepts a manifest and fills the lists it did not mention", () => {
    const parsed = CapabilityManifest.parse(manifest);
    expect(parsed.tags).toEqual([]);
    expect(parsed.requiredPermissions).toEqual([]);
  });

  it("insists on an id, a name and a risk", () => {
    expect(accepts(CapabilityManifest, { ...manifest, id: "" })).toBe(false);
    expect(accepts(CapabilityManifest, { ...manifest, name: "" })).toBe(false);
    expect(accepts(CapabilityManifest, { ...manifest, risk: undefined })).toBe(false);
  });

  it("refuses a risk, latency or cost class nobody defined", () => {
    expect(accepts(CapabilityManifest, { ...manifest, risk: "mostly harmless" })).toBe(false);
    expect(accepts(CapabilityManifest, { ...manifest, latencyClass: "eventually" })).toBe(false);
    expect(accepts(CapabilityManifest, { ...manifest, costClass: "expensive" })).toBe(false);
  });

  it("knows exactly four risks, in the order the permission matrix reads them", () => {
    for (const risk of ["read", "safe_write", "external_effect", "destructive"]) {
      expect(accepts(RiskLevel, risk), risk).toBe(true);
    }
    expect(accepts(RiskLevel, "readonly")).toBe(false);
  });
});

describe("what a capability answers with", () => {
  it("says whether it worked, and may carry output or a reason", () => {
    expect(accepts(CapabilityResult, { ok: true })).toBe(true);
    expect(accepts(CapabilityResult, { ok: true, output: { lines: [] } })).toBe(true);
    expect(accepts(CapabilityResult, { ok: false, error: "no key" })).toBe(true);
    expect(accepts(CapabilityResult, { output: {} })).toBe(false); // ok is not optional
  });

  it("records a run with both ends of its timing, readable", () => {
    const run = { id: "r1", capabilityId: "c", startedAt: T, finishedAt: T, ok: true };
    expect(accepts(CapabilityRun, run)).toBe(true);
    expect(accepts(CapabilityRun, { ...run, startedAt: "yesterday" })).toBe(false);
    expect(accepts(CapabilityRun, { ...run, finishedAt: undefined })).toBe(false);
    expect(accepts(CapabilityRun, { ...run, capabilityId: "" })).toBe(false);
  });
});

describe("an approval is a record of a person's answer", () => {
  const request = { id: "appr-1", capabilityId: "security.update_dependency", risk: "external_effect", reason: "updates a vulnerable dependency", createdAt: T, status: "pending" };

  it("accepts the three states an approval can be in, and nothing else", () => {
    for (const status of ["pending", "approved", "rejected"]) {
      expect(accepts(ApprovalRequest, { ...request, status }), status).toBe(true);
    }
    for (const status of ["maybe", "", "APPROVED", true]) {
      expect(accepts(ApprovalRequest, { ...request, status }), JSON.stringify(status)).toBe(false);
    }
  });

  it("insists on knowing what was asked, when, and at what risk", () => {
    expect(accepts(ApprovalRequest, { ...request, capabilityId: "" })).toBe(false);
    expect(accepts(ApprovalRequest, { ...request, createdAt: "soon" })).toBe(false);
    expect(accepts(ApprovalRequest, { ...request, risk: "spicy" })).toBe(false);
    expect(accepts(ApprovalRequest, { ...request, id: "" })).toBe(false);
  });
});

describe("an audit record", () => {
  const record = { id: "aud-1", at: T, sessionId: "s", kind: "ui_morph", detail: { intent: "surface_incident" } };

  it("ties every entry to a session, a moment and a kind", () => {
    expect(accepts(AuditRecord, record)).toBe(true);
    for (const field of ["id", "sessionId", "kind"] as const) {
      expect(accepts(AuditRecord, { ...record, [field]: "" }), field).toBe(false);
    }
    expect(accepts(AuditRecord, { ...record, at: "recently" })).toBe(false);
  });

  it("takes any detail, because each kind of record explains itself differently", () => {
    for (const detail of [{}, { reasonCodes: ["cooldown_active"] }, { nested: { deep: [1] } }]) {
      expect(accepts(AuditRecord, { ...record, detail })).toBe(true);
    }
    expect(accepts(AuditRecord, { ...record, detail: undefined })).toBe(false);
  });
});

describe("what the interface knows about attention", () => {
  it("assumes nobody is typing until told otherwise", () => {
    expect(AttentionState.parse({}).typing).toBe(false);
    expect(EMPTY_ATTENTION).toEqual({ typing: false });
  });

  it("may name the component in focus and when the person last acted", () => {
    expect(accepts(AttentionState, { typing: true, focusedComponentId: "editor", lastInteractionAt: T })).toBe(true);
    expect(accepts(AttentionState, { typing: "yes" })).toBe(false);
    expect(accepts(AttentionState, { typing: false, lastInteractionAt: "a moment ago" })).toBe(false);
  });
});

describe("a request to a brain", () => {
  const request = { purpose: "decide.runtime", capability: "reason.deep" };

  it("always says what it is for and what kind of thinking it needs", () => {
    expect(accepts(IntelligenceRequest, request)).toBe(true);
    expect(accepts(IntelligenceRequest, { ...request, purpose: "" })).toBe(false);
    expect(accepts(IntelligenceRequest, { capability: "reason.deep" })).toBe(false);
    expect(accepts(IntelligenceRequest, { ...request, capability: "telepathy" })).toBe(false);
  });

  it("carries the hints the router reads, and refuses ones of the wrong kind", () => {
    expect(accepts(IntelligenceRequest, { ...request, privacy: true, latencyTargetMs: 500 })).toBe(true);
    expect(accepts(IntelligenceRequest, { ...request, privacy: "yes" })).toBe(false);
    expect(accepts(IntelligenceRequest, { ...request, latencyTargetMs: "fast" })).toBe(false);
  });

  it("knows the kinds of thinking and the tiers a provider can be", () => {
    for (const capability of ["fast.classification", "reason.general", "reason.deep", "code", "vision", "structured_generation", "embedding"]) {
      expect(accepts(ModelCapability, capability), capability).toBe(true);
    }
    for (const tier of ["free", "local", "standard", "premium"]) {
      expect(accepts(ModelTier, tier), tier).toBe(true);
    }
    expect(accepts(ModelCapability, "reason")).toBe(false);
    expect(accepts(ModelTier, "cheap")).toBe(false);
  });
});
