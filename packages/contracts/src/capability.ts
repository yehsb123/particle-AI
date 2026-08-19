import { z } from "zod";
import { IsoTimestamp, RiskLevel } from "./common";

export const LatencyClass = z.enum(["instant", "fast", "slow"]);
export type LatencyClass = z.infer<typeof LatencyClass>;

export const CostClass = z.enum(["free", "low", "medium", "high"]);
export type CostClass = z.infer<typeof CostClass>;

export const CapabilityManifest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  risk: RiskLevel,
  latencyClass: LatencyClass,
  costClass: CostClass,
  requiredPermissions: z.array(z.string()).default([]),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;

export const CapabilityResult = z.object({
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export type CapabilityResult = z.infer<typeof CapabilityResult>;

/** An audit record of a single capability execution. */
export const CapabilityRun = z.object({
  id: z.string().min(1),
  capabilityId: z.string().min(1),
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp,
  ok: z.boolean(),
  error: z.string().optional(),
});
export type CapabilityRun = z.infer<typeof CapabilityRun>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequest = z.object({
  id: z.string().min(1),
  capabilityId: z.string().min(1),
  risk: RiskLevel,
  reason: z.string(),
  createdAt: IsoTimestamp,
  status: ApprovalStatus,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** A single entry in the audit trail; every decision/execution is auditable. */
export const AuditRecord = z.object({
  id: z.string().min(1),
  at: IsoTimestamp,
  sessionId: z.string().min(1),
  kind: z.string().min(1),
  detail: z.record(z.unknown()),
});
export type AuditRecord = z.infer<typeof AuditRecord>;
