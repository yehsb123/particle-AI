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
   *
   * `detail` holds whatever the runtime recorded — a patch and its ops, a plan and its verdicts —
   * so it goes deep. `structuredClone` throws on a function or a symbol; nothing that belongs in
   * an audit record is either, and a record that cannot be copied is refused loudly here rather
   * than kept as something a reader can still reach into.
   */
  private static copy(record: AuditRecord): AuditRecord {
    return { ...record, detail: structuredClone(record.detail) };
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
