import type { ApprovalReason, ApprovalRequest, RiskLevel } from "@particle/contracts";

/** In-memory store of approval requests for risky capabilities awaiting a human decision. */
/**
 * How many requests one store keeps. A runtime can run for weeks, and every gated capability
 * adds one, so they are bounded — but a question nobody has answered yet is only dropped when
 * there is nothing already-decided left to forget.
 */
export const MAX_APPROVALS = 500;

export class ApprovalStore {
  private items = new Map<string, ApprovalRequest>();

  /** Make room by forgetting the oldest decided request, or the oldest of any kind if none is. */
  private evictOldest(): void {
    for (const [id, req] of this.items) {
      if (req.status !== "pending") {
        this.items.delete(id);
        return;
      }
    }
    const oldest = this.items.keys().next().value;
    if (oldest !== undefined) this.items.delete(oldest);
  }

  create(input: {
    id: string;
    sessionId: string;
    capabilityId: string;
    risk: RiskLevel;
    reason: string;
    createdAt: string;
    reasonCode?: ApprovalReason;
    missingPermissions?: readonly string[];
  }): ApprovalRequest {
    const req: ApprovalRequest = {
      ...input,
      reasonCode: input.reasonCode ?? "risk_above_autonomy",
      // a copy: what the store holds is not something the caller may keep editing afterwards
      missingPermissions: [...(input.missingPermissions ?? [])],
      status: "pending",
    };
    if (!this.items.has(req.id)) {
      while (this.items.size >= MAX_APPROVALS) this.evictOldest();
    }
    this.items.set(req.id, req);
    return { ...req };
  }

  get(id: string): ApprovalRequest | undefined {
    const req = this.items.get(id);
    return req ? { ...req } : undefined;
  }

  /** Copies: a permission record is not something a reader may rewrite. */
  list(): ApprovalRequest[] {
    return [...this.items.values()].map((r) => ({ ...r }));
  }

  approve(id: string): ApprovalRequest | undefined {
    return this.setStatus(id, "approved");
  }

  /** Remove an approval entirely (e.g. after rejection, so it can be re-offered). */
  delete(id: string): boolean {
    return this.items.delete(id);
  }

  reject(id: string): ApprovalRequest | undefined {
    return this.setStatus(id, "rejected");
  }

  /**
   * A decision is final: only a pending request can be decided. Answering an already-answered
   * one gives back the answer that stands, so nothing can quietly turn a refusal into consent.
   */
  private setStatus(id: string, status: ApprovalRequest["status"]): ApprovalRequest | undefined {
    const req = this.items.get(id);
    if (!req) return undefined;
    if (req.status !== "pending") return req.status === status ? { ...req } : undefined;
    const updated = { ...req, status };
    this.items.set(id, updated);
    return { ...updated };
  }
}
