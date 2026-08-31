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
  | { kind: "learned"; sessionId: string; learned: { suppressed: string; dismissals: number } };

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
        this.onMessageCb?.(JSON.parse(ev.data as string) as ServerMessage);
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

  async redo(): Promise<void> {
    await fetch(`${this.httpBase}/api/morph/${this.sessionId}/redo`, { method: "POST", headers: auth() });
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

  async getUI(): Promise<UIBlueprint> {
    const res = await fetch(`${this.httpBase}/api/sessions/${this.sessionId}/ui`, { headers: auth() });
    return (await res.json()) as UIBlueprint;
  }
}
