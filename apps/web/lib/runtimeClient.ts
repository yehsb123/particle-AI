import type { UIBlueprint, WorldState } from "@particle/contracts";

export type ServerMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string }
  | { kind: "decision_created"; sessionId: string; audit: { id: string; kind: string; detail: Record<string, unknown> }[] };

/** Browser client for the Particle AI runtime server (REST + WebSocket). */
export class RuntimeClient {
  private ws?: WebSocket;
  constructor(
    private readonly sessionId: string,
    private readonly httpBase = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:8787",
  ) {}

  get wsUrl(): string {
    return this.httpBase.replace(/^http/, "ws") + `/ws/sessions/${this.sessionId}`;
  }

  connect(onMessage: (m: ServerMessage) => void, onStatus: (open: boolean) => void): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onopen = () => onStatus(true);
    ws.onclose = () => onStatus(false);
    ws.onerror = () => onStatus(false);
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = undefined;
  }

  async emitSim(key: string): Promise<void> {
    await fetch(`${this.httpBase}/api/sim/${this.sessionId}/${key}`, { method: "POST" });
  }

  async undo(): Promise<void> {
    await fetch(`${this.httpBase}/api/morph/${this.sessionId}/undo`, { method: "POST" });
  }

  async getUI(): Promise<UIBlueprint> {
    const res = await fetch(`${this.httpBase}/api/sessions/${this.sessionId}/ui`);
    return (await res.json()) as UIBlueprint;
  }
}
