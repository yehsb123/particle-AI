export type LogLevel = "debug" | "info" | "warn" | "error";
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogFields = Record<string, unknown>;
export type Sink = (line: { level: LogLevel; msg: string; fields?: LogFields }) => void;

/** Minimal structured logger. Every runtime decision links event/decision/patch ids. */
export function createLogger(minLevel: LogLevel = "info", sink?: Sink) {
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[level] < RANK[minLevel]) return;
    if (sink) sink({ level, msg, fields });
    // default sink: structured console line
    else console[level === "debug" ? "log" : level](JSON.stringify({ level, msg, ...fields }));
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

/** Collects traces for replay/inspection. Bounded ring. */
export class TraceStore {
  private traces: RuntimeTrace[] = [];
  constructor(private readonly limit = 500) {}

  append(trace: RuntimeTrace): void {
    this.traces.push(trace);
    if (this.traces.length > this.limit) this.traces.shift();
  }

  list(sessionId?: string): RuntimeTrace[] {
    return sessionId ? this.traces.filter((t) => t.sessionId === sessionId) : [...this.traces];
  }

  count(): number {
    return this.traces.length;
  }
}
