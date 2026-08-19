import type { AuditRecord } from "@dm/contracts";

/** Append-only audit trail. Every autonomous decision and execution lands here. */
export class AuditLog {
  private records: AuditRecord[] = [];

  append(record: AuditRecord): AuditRecord {
    this.records.push(record);
    return record;
  }

  list(sessionId?: string): AuditRecord[] {
    return sessionId ? this.records.filter((r) => r.sessionId === sessionId) : [...this.records];
  }

  count(): number {
    return this.records.length;
  }
}
