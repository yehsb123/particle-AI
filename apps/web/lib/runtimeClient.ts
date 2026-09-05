import { ApprovalRequest as ApprovalRequestSchema, SessionSummary as SessionSummarySchema, UIBlueprint as UIBlueprintSchema, WorldState as WorldStateSchema } from "@particle/contracts";
import { ApprovalDecisionSchema, AuditRecord as AuditRecordSchema } from "@particle/contracts";
import type { ApprovalRequest, AuditRecord, RuntimeMessage, SessionSummary, UIBlueprint, WorldState } from "@particle/contracts";

export type SimResponse = {
  deliberated?: boolean;
  morph?: { applied: boolean; guardReasonCodes: string[] };
  pendingApprovals?: ApprovalRequest[];
  patternSuggestions?: { key: string; count: number }[];
  learned?: { suppressed: string; dismissals: number };
  retryAfterMs?: number;
};

/** What the runtime says to a body watching a session. One declaration, in the contracts. */
export type ServerMessage = RuntimeMessage;

/**
 * Shared secret (optional): from the page URL (`?token=` — how the extension side panel passes it)
 * or the build-time env. Sent as a header on REST and as `?token=` on the WS upgrade.
 */
const TOKEN =
  (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") : null) ??
  process.env.NEXT_PUBLIC_DM_TOKEN ??
  "";
function auth(extra: Record<string, string> = {}): Record<string, string> {
  return TOKEN ? { ...extra, "x-particle-token": TOKEN } : extra;
}

/** Browser client for the Particle AI runtime server (REST + WebSocket). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * A frame off the socket, checked before the body believes it.
 *
 * Everything that parsed as JSON used to be handed straight up as a ServerMessage — a cast, not a
 * check — so a number or a null reached a handler that reads `.kind` off it, a ui_patch could
 * carry no blueprint at all, and a frame addressed to another session was applied to this body.
 * Anything that is not a frame for this session, of a kind the body knows, carrying what that
 * kind is supposed to carry, is dropped exactly like an unparseable one.
 */
export function parseServerMessage(data: unknown, sessionId: string): ServerMessage | null {
  if (!isRecord(data)) return null;
  if (typeof data.kind !== "string" || data.sessionId !== sessionId) return null;

  switch (data.kind) {
    case "ui_patch":
      return UIBlueprintSchema.safeParse(data.blueprint).success ? (data as unknown as ServerMessage) : null;
    case "world_state_changed":
      return WorldStateSchema.safeParse(data.worldState).success ? (data as unknown as ServerMessage) : null;
    case "ai_presence_changed":
      return typeof data.state === "string" ? (data as unknown as ServerMessage) : null;
    case "decision_created": {
      const audit = parseAuditRecords(data.audit);
      // a frame whose every record is unreadable says nothing this body can draw
      return audit.length > 0 ? ({ ...data, audit } as unknown as ServerMessage) : null;
    }
    case "learned":
      return isRecord(data.learned) && typeof data.learned.suppressed === "string" && typeof data.learned.dismissals === "number"
        ? (data as unknown as ServerMessage)
        : null;
    case "pattern_suggestions":
      return Array.isArray(data.suggestions) &&
        data.suggestions.every((s) => isRecord(s) && typeof s.key === "string" && typeof s.count === "number")
        ? (data as unknown as ServerMessage)
        : null;
    case "approval_asked":
      return parseApprovals(data.approvals).length > 0 ? (data as unknown as ServerMessage) : null;
    case "approval_decided":
      return typeof data.approvalId === "string" && data.approvalId.length > 0 && ApprovalDecisionSchema.safeParse(data.decision).success
        ? (data as unknown as ServerMessage)
        : null;
    default:
      return null; // a kind this body does not know is not one it should act on
  }
}

/**
 * The body this session already has on the runtime, or nothing.
 *
 * This is what the body draws the moment it connects, before any event arrives, and it used to be
 * cast straight into the renderer — past the one gate the blueprint schema exists to stand in
 * front of. Its version is pinned on purpose: a blueprint written by another build is to be
 * refused rather than drawn under this build's assumptions. And an answer that is not a blueprint
 * at all is not an empty body, it is a thrown error: the renderer reads the root of whatever it
 * is handed, and reading it off an error body takes the whole interface down.
 */
export function parseBlueprint(data: unknown): UIBlueprint | null {
  const parsed = UIBlueprintSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * A link to another session's body on this runtime.
 *
 * The token this page is using travels with it. It arrived in this page's own address — the
 * extension side panel puts it there, since a page cannot read the extension's storage — and a
 * link that dropped it opened a body that could no longer reach the runtime at all, with nothing
 * said about why. The link is same-origin, so carrying it there is not carrying it anywhere new.
 */
export function sessionHref(sessionId: unknown, token: string = TOKEN): string {
  const query = new URLSearchParams({ connect: "1", session: typeof sessionId === "string" ? sessionId : "" });
  if (token) query.set("token", token);
  return `/?${query.toString()}`;
}

/**
 * The approvals in something the runtime sent, kept only where each is what it claims to be.
 *
 * They arrive two ways — in the answer to the call that caused them, and over the socket to every
 * other body watching the session — and both doors have to check the same thing, so there is one
 * of this rather than one per door.
 */
export function parseApprovals(raw: unknown): ApprovalRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalRequest[] = [];
  for (const item of raw.slice(0, MAX_APPROVALS_PER_ANSWER)) {
    const parsed = ApprovalRequestSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** How many records one decision frame may carry into the inspector. */
const MAX_AUDIT_PER_FRAME = 100;

/**
 * The audit records in a decision frame, kept only where each is what it claims to be.
 *
 * This door checked that the frame carried a list and never what was in it, and the inspector
 * draws each record straight: its kind as text, its detail stringified, its id as the key of the
 * row. A kind that is an object is not text, and React refuses one as a child — which empties the
 * body rather than one row, in the one place a person goes to find out why it changed.
 */
export function parseAuditRecords(raw: unknown): AuditRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditRecord[] = [];
  for (const item of raw.slice(0, MAX_AUDIT_PER_FRAME)) {
    const parsed = AuditRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Caps on what one answer may carry, so a server cannot hand the body an unbounded list. */
const MAX_APPROVALS_PER_ANSWER = 50;
const MAX_REASON_CODES = 20;
const MAX_SUGGESTIONS = 20;
/** The runtime keeps up to 500 sessions; the body does not have to draw all of them to say so. */
const MAX_SESSIONS_SHOWN = 50;

/**
 * The other sessions this runtime senses, kept only where each is what it claims to be. The rail
 * reads a layer list off every entry, and reading `.length` off something that is not a list
 * throws inside the render — which takes the whole body down rather than one row.
 */
export function parseSessions(data: unknown): SessionSummary[] {
  if (!isRecord(data) || !Array.isArray(data.sessions)) return [];
  const out: SessionSummary[] = [];
  for (const raw of data.sessions.slice(0, MAX_SESSIONS_SHOWN)) {
    const parsed = SessionSummarySchema.safeParse(raw);
    if (parsed.success) {
      out.push(parsed.data);
      continue;
    }
    // A session that exists is the thing this rail is for. A runtime that has changed the shape of
    // one field would otherwise empty the rail entirely, and "no other sessions" is a confident
    // lie where "a session that reports nothing" is only a quiet one.
    if (!isRecord(raw) || typeof raw.sessionId !== "string" || !raw.sessionId) continue;
    out.push({
      sessionId: raw.sessionId,
      ...(typeof raw.intent === "string" ? { intent: raw.intent } : {}),
      problems: typeof raw.problems === "number" && Number.isFinite(raw.problems) && raw.problems > 0 ? Math.floor(raw.problems) : 0,
      layers: Array.isArray(raw.layers) ? raw.layers.filter((l): l is string => typeof l === "string") : [],
    });
  }
  return out;
}

/**
 * What the server said about an event, kept only where it is what it claims to be.
 *
 * This answer used to be cast. Everything downstream then assumed it: the approval card read a
 * risk and a list of missing permissions straight out of it and put them through helpers that
 * format a name, and a name that was not a string threw inside the render — which in React takes
 * the whole body down, not one card. A field that is not what it claims is dropped, and the rest
 * of the answer is still used: an older or newer server should cost the person one card, never
 * the interface.
 */
export function parseSimResponse(data: unknown): SimResponse | null {
  if (!isRecord(data)) return null;
  const out: SimResponse = {};

  if (typeof data.deliberated === "boolean") out.deliberated = data.deliberated;
  if (typeof data.retryAfterMs === "number" && Number.isFinite(data.retryAfterMs)) out.retryAfterMs = data.retryAfterMs;

  if (isRecord(data.morph)) {
    out.morph = {
      applied: data.morph.applied === true,
      guardReasonCodes: Array.isArray(data.morph.guardReasonCodes)
        ? data.morph.guardReasonCodes.filter((c): c is string => typeof c === "string").slice(0, MAX_REASON_CODES)
        : [],
    };
  }

  const approvals = parseApprovals(data.pendingApprovals);
  if (approvals.length > 0) out.pendingApprovals = approvals;

  if (Array.isArray(data.patternSuggestions)) {
    out.patternSuggestions = data.patternSuggestions
      .filter((s): s is { key: string; count: number } => isRecord(s) && typeof s.key === "string" && typeof s.count === "number")
      .slice(0, MAX_SUGGESTIONS);
  }

  if (isRecord(data.learned) && typeof data.learned.suppressed === "string" && typeof data.learned.dismissals === "number") {
    out.learned = { suppressed: data.learned.suppressed, dismissals: data.learned.dismissals };
  }

  return out;
}

export class RuntimeClient {
  private ws?: WebSocket;
  private manualClose = false;
  private attempts = 0;
  private onMessageCb?: (m: ServerMessage) => void;
  private onStatusCb?: (open: boolean) => void;

  constructor(
    private readonly sessionId: string,
    private readonly httpBase = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:8787",
  ) {}

  get wsUrl(): string {
    const q = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";
    return this.httpBase.replace(/^http/, "ws") + `/ws/sessions/${this.sessionId}${q}`;
  }

  connect(onMessage: (m: ServerMessage) => void, onStatus: (open: boolean) => void): void {
    this.onMessageCb = onMessage;
    this.onStatusCb = onStatus;
    this.manualClose = false;
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.onStatusCb?.(true);
    };
    ws.onclose = () => {
      this.onStatusCb?.(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => this.onStatusCb?.(false);
    ws.onmessage = (ev) => {
      try {
        const message = parseServerMessage(JSON.parse(ev.data as string), this.sessionId);
        if (message) this.onMessageCb?.(message);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.attempts >= 5) return;
    const delay = Math.min(1000 * 2 ** this.attempts, 10_000); // 1s,2s,4s,8s,10s
    this.attempts++;
    setTimeout(() => {
      if (!this.manualClose) this.open();
    }, delay);
  }

  disconnect(): void {
    this.manualClose = true;
    this.ws?.close();
    this.ws = undefined;
  }


  /** Send a raw MatterEvent to the server (behavior keys, sensors) — same path the extension uses. */
  async emit(event: unknown): Promise<SimResponse | null> {
    const res = await fetch(`${this.httpBase}/api/events`, {
      method: "POST",
      headers: auth({ "content-type": "application/json" }),
      body: JSON.stringify(event),
    });
    return parseSimResponse(await res.json().catch(() => null));
  }

  async emitSim(key: string): Promise<SimResponse | null> {
    const res = await fetch(`${this.httpBase}/api/sim/${this.sessionId}/${key}`, { method: "POST", headers: auth() });
    return parseSimResponse(await res.json().catch(() => null));
  }

  async undo(opts: { componentId?: string; learn?: boolean } = {}): Promise<void> {
    await fetch(`${this.httpBase}/api/morph/${this.sessionId}/undo`, {
      method: "POST",
      headers: auth({ "content-type": "application/json" }),
      body: JSON.stringify(opts),
    });
  }

  async redo(): Promise<boolean> {
    const res = await fetch(`${this.httpBase}/api/morph/${this.sessionId}/redo`, { method: "POST", headers: auth() });
    const body = (await res.json().catch(() => null)) as { redone?: boolean } | null;
    return body?.redone === true;
  }

  async approve(approvalId: string): Promise<void> {
    await fetch(`${this.httpBase}/api/approvals/${approvalId}/approve`, { method: "POST", headers: auth() });
  }

  async reject(approvalId: string): Promise<void> {
    await fetch(`${this.httpBase}/api/approvals/${approvalId}/reject`, { method: "POST", headers: auth() });
  }

  async setAutonomy(level: number): Promise<void> {
    await fetch(`${this.httpBase}/api/autonomy/${level}`, { method: "POST", headers: auth() });
  }

  async sessions(): Promise<SessionSummary[]> {
    const res = await fetch(`${this.httpBase}/api/sessions`, { headers: auth() });
    return parseSessions(await res.json().catch(() => null));
  }

  async getUI(): Promise<UIBlueprint | null> {
    const res = await fetch(`${this.httpBase}/api/sessions/${this.sessionId}/ui`, { headers: auth() });
    return parseBlueprint(await res.json().catch(() => null));
  }
}
