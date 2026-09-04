import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeClient, type ServerMessage } from "./runtimeClient";
import { UI_SCHEMA_VERSION } from "@particle/contracts";

const realBlueprint = {
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws",
  mode: "development",
  root: { id: "root", type: "Stack", children: [] },
  metadata: { generatedAt: "2026-09-04T00:00:00Z", decisionId: "d", confidence: 1 },
};

/**
 * The browser client is the whole connected-mode contract: which URL each action hits, what it
 * sends, how server frames reach the body, and what happens when the socket drops. E2E can only
 * see the happy path, so the wire details and the reconnect policy are pinned here.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

let calls: { url: string; init?: RequestInit }[] = [];
function stubFetch(body: unknown = {}, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok, json: async () => body } as unknown as Response;
    }),
  );
}
const headerOf = (i: number, name: string) => (calls[i]!.init!.headers as Record<string, string> | undefined)?.[name];

beforeEach(() => {
  calls = [];
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RuntimeClient — REST contract", () => {
  const c = () => new RuntimeClient("s1", "http://rt.test:8787");

  it("hits one endpoint per action, with the method and body the server expects", async () => {
    stubFetch({ redone: true, sessions: [{ sessionId: "s1", problems: 0, layers: [] }] });
    const client = c();
    await client.emitSim("http-500");
    await client.undo({ componentId: "context", learn: false });
    await client.redo();
    await client.approve("appr-1");
    await client.reject("appr-2");
    await client.setAutonomy(4);
    await client.getUI();
    await client.sessions();

    expect(calls.map((x) => x.url)).toEqual([
      "http://rt.test:8787/api/sim/s1/http-500",
      "http://rt.test:8787/api/morph/s1/undo",
      "http://rt.test:8787/api/morph/s1/redo",
      "http://rt.test:8787/api/approvals/appr-1/approve",
      "http://rt.test:8787/api/approvals/appr-2/reject",
      "http://rt.test:8787/api/autonomy/4",
      "http://rt.test:8787/api/sessions/s1/ui",
      "http://rt.test:8787/api/sessions",
    ]);
    expect(calls.slice(0, 6).every((x) => x.init?.method === "POST")).toBe(true);
    expect(calls[6]!.init?.method).toBeUndefined(); // getUI is a plain GET
    // undo carries the attribution the learning ledger needs
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ componentId: "context", learn: false });
  });

  it("reports whether the server actually redid something", async () => {
    stubFetch({ redone: false });
    expect(await c().redo()).toBe(false);
    stubFetch({ redone: true });
    expect(await c().redo()).toBe(true);
  });

  it("never throws on a malformed response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("not json"); } }) as unknown as Response));
    expect(await c().emitSim("x")).toBeNull();
    expect(await c().redo()).toBe(false);
    expect(await c().sessions()).toEqual([]);
  });

  it("sends a raw behaviour event to /api/events (the same path the sensors use)", async () => {
    await c().emit({ id: "e1", sessionId: "s1", type: "user.action", payload: { key: "k" } });
    expect(calls[0]!.url).toBe("http://rt.test:8787/api/events");
    expect(headerOf(0, "content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init!.body)).type).toBe("user.action");
  });

  it("sends no token header when none is configured", async () => {
    await c().emitSim("x");
    expect(headerOf(0, "x-particle-token")).toBeUndefined();
    expect(c().wsUrl).toBe("ws://rt.test:8787/ws/sessions/s1");
  });
});

describe("RuntimeClient — token mode (fresh module, env token)", () => {
  it("puts the token in the REST header and the WebSocket query", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_DM_TOKEN = "t0k en/+";
    try {
      const { RuntimeClient: Fresh } = await import("./runtimeClient");
      const client = new Fresh("ext", "http://rt.test:8787");
      await client.emitSim("x");
      expect(headerOf(0, "x-particle-token")).toBe("t0k en/+");
      // the WS upgrade cannot carry headers, so the token is URL-encoded into the query
      expect(client.wsUrl).toBe("ws://rt.test:8787/ws/sessions/ext?token=t0k%20en%2F%2B");
    } finally {
      delete process.env.NEXT_PUBLIC_DM_TOKEN;
      vi.resetModules();
    }
  });
});

describe("RuntimeClient — socket lifecycle", () => {
  it("forwards valid frames, ignores malformed ones, and reports open/closed", () => {
    const seen: ServerMessage[] = [];
    const status: boolean[] = [];
    const client = new RuntimeClient("s1", "http://rt.test:8787");
    client.connect((m) => seen.push(m), (o) => status.push(o));

    const sock = FakeSocket.instances[0]!;
    sock.onopen?.();
    sock.onmessage?.({ data: JSON.stringify({ kind: "ui_patch", sessionId: "s1", blueprint: realBlueprint }) });
    sock.onmessage?.({ data: "{not json" }); // a malformed frame must not kill the connection
    sock.onmessage?.({ data: JSON.stringify({ kind: "ui_patch", sessionId: "s1", blueprint: { root: { id: "r" } } }) }); // not a blueprint — dropped
    sock.onmessage?.({ data: JSON.stringify({ kind: "learned", sessionId: "s1", learned: { suppressed: "augment:stuck", dismissals: 2 } }) });

    expect(seen.map((m) => m.kind)).toEqual(["ui_patch", "learned"]);
    expect(status).toEqual([true]);
    sock.onerror?.();
    expect(status).toEqual([true, false]);
  });

  it("reconnects with exponential backoff, capped, and stops after five tries", () => {
    vi.useFakeTimers();
    const client = new RuntimeClient("s1", "http://rt.test:8787");
    client.connect(() => {}, () => {});
    expect(FakeSocket.instances).toHaveLength(1);

    const delays = [1000, 2000, 4000, 8000, 10_000]; // 1s,2s,4s,8s then capped at 10s
    delays.forEach((d, i) => {
      FakeSocket.instances[i]!.onclose?.();
      vi.advanceTimersByTime(d - 1);
      expect(FakeSocket.instances).toHaveLength(i + 1); // not yet
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(i + 2); // reconnected
    });

    // sixth close: the client gives up instead of hammering the server forever
    FakeSocket.instances[5]!.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(6);
  });

  it("disconnect() closes the socket and cancels any pending reconnect", () => {
    vi.useFakeTimers();
    const client = new RuntimeClient("s1", "http://rt.test:8787");
    client.connect(() => {}, () => {});
    const sock = FakeSocket.instances[0]!;
    sock.onclose?.(); // a reconnect is now scheduled
    client.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1); // the pending reconnect was abandoned
    expect(sock.closed).toBe(true);
  });
});
