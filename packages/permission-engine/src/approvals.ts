import type { ApprovalRequest, RiskLevel } from "@particle/contracts";

/** In-memory store of approval requests for risky capabilities awaiting a human decision. */
export class ApprovalStore {
  private items = new Map<string, ApprovalRequest>();

  create(input: { id: string; capabilityId: string; risk: RiskLevel; reason: string; createdAt: string }): ApprovalRequest {
    const req: ApprovalRequest = { ...input, status: "pending" };
    this.items.set(req.id, req);
    return req;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.items.get(id);
  }

  list(): ApprovalRequest[] {
    return [...this.items.values()];
  }

  approve(id: string): ApprovalRequest | undefined {
    return this.setStatus(id, "approved");
  }

  reject(id: string): ApprovalRequest | undefined {
    return this.setStatus(id, "rejected");
  }

  private setStatus(id: string, status: ApprovalRequest["status"]): ApprovalRequest | undefined {
    const req = this.items.get(id);
    if (!req) return undefined;
    const updated = { ...req, status };
    this.items.set(id, updated);
    return updated;
  }
}
