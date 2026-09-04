import { UIBlueprint as UIBlueprintSchema, WorldState as WorldStateSchema } from "@particle/contracts";
import type { ApprovalRequest, UIBlueprint, WorldState } from "@particle/contracts";

export type SimResponse = {
  deliberated?: boolean;
  morph?: { applied: boolean; guardReasonCodes: string[] };
  pendingApprovals?: ApprovalRequest[];
  patternSuggestions?: { key: string; count: number }[];
  learned?: { suppressed: string; dismissals: number };
  retryAfterMs?: number;
};

export type ServerMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string }
  | { kind: "decision_created"; sessionId: string; audit: { id: string; kind: string; detail: Record<string, unknown> }[] }
  | { kind: "learned"; sessionId: string; learned: { suppressed: string; dismissals: number } }
  | { kind: "pattern_suggestions"; sessionId: string; suggestions: { key: string; count: number }[] };

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
    case "decision_created":
      return Array.isArray(data.audit) ? (data as unknown as ServerMessage) : null;
    case "learned":
      return isRecord(data.learned) && typeof data.learned.suppressed === "string" && typeof data.learned.dismissals === "number"
        ? (data as unknown as ServerMessage)
        : null;
    case "pattern_suggestions":
      return Array.isArray(data.suggestions) &&
        data.suggestions.every((s) => isRecord(s) && typeof s.key === "string" && typeof s.count === "number")
        ? (data as unknown as ServerMessage)
        : null;
    default:
      return null; // a kind this body does not know is not one it should act on
  }
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
    return (await res.json().catch(() => null)) as SimResponse | null;
  }

  async emitSim(key: string): Promise<SimResponse | null> {
    const res = await fetch(`${this.httpBase}/api/sim/${this.sessionId}/${key}`, { method: "POST", headers: auth() });
    return (await res.json().catch(() => null)) as SimResponse | null;
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

  async sessions(): Promise<{ sessionId: string; intent?: string; problems: number; layers: string[] }[]> {
    const res = await fetch(`${this.httpBase}/api/sessions`, { headers: auth() });
    const body = (await res.json().catch(() => null)) as { sessions?: { sessionId: string; intent?: string; problems: number; layers: string[] }[] } | null;
    return body?.sessions ?? [];
  }

  async getUI(): Promise<UIBlueprint> {
    const res = await fetch(`${this.httpBase}/api/sessions/${this.sessionId}/ui`, { headers: auth() });
    return (await res.json()) as UIBlueprint;
  }
}
