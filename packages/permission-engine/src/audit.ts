import type { AuditRecord } from "@particle/contracts";

/** Append-only audit trail. Every autonomous decision and execution lands here. */
export class AuditLog {
  private records: AuditRecord[] = [];

  /** Bounded ring so a long-lived process doesn't grow the audit trail without limit. */
  constructor(private readonly limit = 5_000) {}

  /**
   * Copies in and copies out, the way the approval store beside this one works. A record the
   * caller still holds, or one a reader was handed, is otherwise the same object this log is
   * keeping: append-only stops meaning anything if what was appended can be edited afterwards.
   */
  private static copy(record: AuditRecord): AuditRecord {
    return { ...record, detail: { ...record.detail } };
  }

  append(record: AuditRecord): AuditRecord {
    const kept = AuditLog.copy(record);
    this.records.push(kept);
    if (this.records.length > this.limit) this.records.shift();
    return AuditLog.copy(kept);
  }

  list(sessionId?: string): AuditRecord[] {
    const matching = sessionId ? this.records.filter((r) => r.sessionId === sessionId) : this.records;
    return matching.map((r) => AuditLog.copy(r));
  }

  count(): number {
    return this.records.length;
  }
}
