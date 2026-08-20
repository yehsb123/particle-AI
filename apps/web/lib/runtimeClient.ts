import type { ApprovalRequest, UIBlueprint, WorldState } from "@particle/contracts";

export type ServerMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string }
  | { kind: "decision_created"; sessionId: string; audit: { id: string; kind: string; detail: Record<string, unknown> }[] };

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
    return this.httpBase.replace(/^http/, "ws") + `/ws/sessions/${this.sessionId}`;
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

  async emitSim(key: string): Promise<{ pendingApprovals?: ApprovalRequest[] } | null> {
    const res = await fetch(`${this.httpBase}/api/sim/${this.sessionId}/${key}`, { method: "POST" });
    return (await res.json().catch(() => null)) as { pendingApprovals?: ApprovalRequest[] } | null;
  }

  async undo(): Promise<void> {
    await fetch(`${this.httpBase}/api/morph/${this.sessionId}/undo`, { method: "POST" });
  }

  async approve(approvalId: string): Promise<void> {
    await fetch(`${this.httpBase}/api/approvals/${approvalId}/approve`, { method: "POST" });
  }

  async reject(approvalId: string): Promise<void> {
    await fetch(`${this.httpBase}/api/approvals/${approvalId}/reject`, { method: "POST" });
  }

  async getUI(): Promise<UIBlueprint> {
    const res = await fetch(`${this.httpBase}/api/sessions/${this.sessionId}/ui`);
    return (await res.json()) as UIBlueprint;
  }
}
