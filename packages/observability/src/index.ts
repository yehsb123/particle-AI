export type LogLevel = "debug" | "info" | "warn" | "error";
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * The level usually arrives from DM_LOG_LEVEL, which is a string nobody has checked. An
 * unrecognised one used to leave every comparison undefined, so a run asking for quiet got
 * every debug line instead. Case and stray spaces are forgiven; anything else falls back.
 */
export function normalizeLevel(level: unknown, fallback: LogLevel = "info"): LogLevel {
  const key = typeof level === "string" ? level.trim().toLowerCase() : "";
  // `in` walks the prototype chain, so "toString" and "__proto__" would pass as levels and
  // put the floor at a function. Only the four own keys count.
  return Object.hasOwn(RANK, key) ? (key as LogLevel) : fallback;
}

export type LogFields = Record<string, unknown>;
export type Sink = (line: { level: LogLevel; msg: string; fields?: LogFields }) => void;

/**
 * Minimal structured logger. Every runtime decision links event/decision/patch ids.
 *
 * Nothing here throws. A logger is called from inside catch blocks, so a logger that fails turns
 * a failure somebody was handling into one nobody is: a field that cannot be serialised — a
 * circular object, a bigint — used to take down the operation that was trying to report a
 * problem. The line still goes out, saying its fields could not be written, and a sink the host
 * supplied is given the same treatment, since a bug in one is not a reason to fail an ingest.
 */
export function createLogger(minLevel: LogLevel | string = "info", sink?: Sink) {
  const floor = normalizeLevel(minLevel);
  const write = (level: LogLevel, line: string) => {
    try {
      console[level === "debug" ? "log" : level](line);
    } catch {
      /* a console that cannot be written to is not something a logger can report */
    }
  };
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[level] < RANK[floor]) return;
    if (sink) {
      try {
        sink({ level, msg, fields });
      } catch {
        write(level, JSON.stringify({ level, msg, sinkFailed: true }));
      }
      return;
    }
    // default sink: structured console line
    try {
      write(level, JSON.stringify({ level, msg, ...fields }));
    } catch {
      write(level, JSON.stringify({ level, msg, fieldsUnserializable: true }));
    }
  };
  return {
    debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
    info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
    warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
    error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
  };
}
export type Logger = ReturnType<typeof createLogger>;

/** One row in the developer inspector: the full "why did the UI change" trace of an event. */
export type RuntimeTrace = {
  at: string;
  sessionId: string;
  eventId: string;
  eventType: string;
  significance: number;
  deliberated: boolean;
  providerId?: string;
  usedFallback?: boolean;
  decisionId?: string;
  capabilityIds: string[];
  morphApplied: boolean;
  guardReasonCodes: string[];
};

/**
 * Collects traces for inspection: the "why did the UI change" row behind each event.
 *
 * Bounded per session rather than across all of them. One ring for everybody meant a busy session
 * pushed out the traces of every quiet session beside it, and the inspector of a session that had
 * done nothing wrong showed nothing at all — the one place a person looks to find out why their
 * body changed. Sessions are held in a map rather than under a composed key, so no session id can
 * be spelled to reach another's traces.
 */
export class TraceStore {
  private bySession = new Map<string, RuntimeTrace[]>();

  constructor(
    private readonly perSession = 50,
    private readonly maxSessions = 200,
  ) {}

  append(trace: RuntimeTrace): void {
    const existing = this.bySession.get(trace.sessionId);
    // re-inserting moves this session to the end: what is written to stays, what went quiet goes
    if (existing) this.bySession.delete(trace.sessionId);
    const ring = existing ?? [];
    ring.push(trace);
    if (ring.length > this.perSession) ring.shift();
    this.bySession.set(trace.sessionId, ring);
    while (this.bySession.size > this.maxSessions) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === undefined) break;
      this.bySession.delete(oldest);
    }
  }

  list(sessionId?: string): RuntimeTrace[] {
    if (sessionId !== undefined) return [...(this.bySession.get(sessionId) ?? [])];
    return [...this.bySession.values()].flat();
  }

  count(): number {
    let total = 0;
    for (const ring of this.bySession.values()) total += ring.length;
    return total;
  }
}
