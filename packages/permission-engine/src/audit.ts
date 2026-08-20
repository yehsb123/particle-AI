import type { AuditRecord } from "@particle/contracts";

/** Append-only audit trail. Every autonomous decision and execution lands here. */
export class AuditLog {
  private records: AuditRecord[] = [];

  /** Bounded ring so a long-lived process doesn't grow the audit trail without limit. */
  constructor(private readonly limit = 5_000) {}

  append(record: AuditRecord): AuditRecord {
    this.records.push(record);
    if (this.records.length > this.limit) this.records.shift();
    return record;
  }

  list(sessionId?: string): AuditRecord[] {
    return sessionId ? this.records.filter((r) => r.sessionId === sessionId) : [...this.records];
  }

  count(): number {
    return this.records.length;
  }
}
