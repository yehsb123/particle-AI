import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { obsCaptureBackend, readObsConfig } from "./backend";
import type { ObsSocket, ObsSocketFactory } from "./backend";
import { OBS_OPCODE } from "./protocol";

/**
 * An OBS that is not OBS: it speaks the handshake the protocol document describes and hands back
 * a picture. The client is driven through its real path — greeting, identify, request, answer —
 * rather than having its own methods stubbed, so these tests fail if the client stops speaking
 * the protocol.
 */
function fakeObs(options: { auth?: { challenge: string; salt: string }; image?: string; fail?: string } = {}): {
  factory: ObsSocketFactory;
  sent: Array<Record<string, unknown>>;
  urls: string[];
} {
  const sent: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const factory: ObsSocketFactory = (url) => {
    urls.push(url);
    const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    const emit = (type: string, event: { data?: unknown } = {}): void => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    const socket: ObsSocket = {
      send(text: string) {
        const message = JSON.parse(text) as { op: number; d: Record<string, unknown> };
        sent.push(message);
        if (message.op === OBS_OPCODE.identify) {
          queueMicrotask(() => emit("message", { data: JSON.stringify({ op: OBS_OPCODE.identified, d: { negotiatedRpcVersion: 1 } }) }));
          return;
        }
        if (message.op === OBS_OPCODE.request) {
          const requestId = message.d.requestId;
          const requestStatus = options.fail
            ? { result: false, code: 600, comment: options.fail }
            : { result: true, code: 100 };
          const responseData = options.fail ? undefined : { imageData: options.image ?? "" };
          queueMicrotask(() =>
            emit("message", {
              data: JSON.stringify({ op: OBS_OPCODE.requestResponse, d: { requestType: message.d.requestType, requestId, requestStatus, responseData } }),
            }),
          );
        }
      },
      close() {},
      addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        const existing = listeners.get(type) ?? [];
        existing.push(listener);
        listeners.set(type, existing);
      },
    };
    const hello: Record<string, unknown> = { obsWebSocketVersion: "5.5.2", rpcVersion: 1, obsStudioVersion: "30.2.2" };
    if (options.auth) hello.authentication = options.auth;
    queueMicrotask(() => {
      emit("open");
      emit("message", { data: JSON.stringify({ op: OBS_OPCODE.hello, d: hello }) });
    });
    return socket;
  };
  return { factory, sent, urls };
}

/** A real, if tiny, PNG: the signature, an IHDR chunk, and nothing else. */
function tinyPng(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function scratchFile(): { path: string; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "particle-obs-"));
  return { path: join(dir, "shot.png"), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("what the OBS backend reads from the environment", () => {
  it("reaches the local OBS unless somebody names another", () => {
    expect(readObsConfig({}).url).toBe("ws://127.0.0.1:4455");
    expect(readObsConfig({ DM_OBS_URL: " ws://10.0.0.2:4455 " }).url).toBe("ws://10.0.0.2:4455");
  });

  it("refuses an address that is not a websocket address", () => {
    for (const bad of ["http://127.0.0.1:4455", "127.0.0.1:4455", "ftp://x"]) {
      expect(() => readObsConfig({ DM_OBS_URL: bad }), bad).toThrow(/DM_OBS_URL/);
    }
  });

  it("has no password and no source until somebody sets them", () => {
    expect(readObsConfig({}).password).toBe("");
    expect(readObsConfig({}).source).toBe("");
    expect(readObsConfig({ DM_OBS_SOURCE: " Window Capture " }).source).toBe("Window Capture");
  });
});

describe("taking a picture through OBS", () => {
  it("walks the handshake and writes the picture it was handed", async () => {
    const file = scratchFile();
    const obs = fakeObs({ image: tinyPng(1280, 720).toString("base64") });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "KakaoTalk" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame.backend).toBe("obs");
      expect(result.frame.width).toBe(1280);
      expect(result.frame.height).toBe(720);
      expect(result.frame.bytes).toBe(24);
      expect(result.frame.app).toBe("obs");
      expect(result.frame.window).toBe("KakaoTalk");
      expect(readFileSync(file.path).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    expect(obs.urls).toEqual(["ws://127.0.0.1:4455"]);
    expect(obs.sent.map((m) => m.op)).toEqual([OBS_OPCODE.identify, OBS_OPCODE.request]);
    expect(obs.sent[1]?.d).toMatchObject({ requestType: "GetSourceScreenshot", requestData: { sourceName: "KakaoTalk", imageFormat: "png" } });
    file.clean();
  });

  it("photographs the source the caller named rather than the configured one", async () => {
    const file = scratchFile();
    const obs = fakeObs({ image: tinyPng(10, 10).toString("base64") });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "configured" }, connect: obs.factory });
    await backend.capture({ target: { kind: "app", app: "KakaoTalk" }, path: file.path });
    expect(obs.sent[1]?.d).toMatchObject({ requestData: { sourceName: "KakaoTalk" } });
    file.clean();
  });

  it("proves it knows the password when OBS asks for one", async () => {
    const file = scratchFile();
    const obs = fakeObs({
      auth: { challenge: "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=", salt: "82RGdbPHgSNkAZ4aRGEBXNlJfweWQtAgZbxYm5Bg2cw=" },
      image: tinyPng(10, 10).toString("base64"),
    });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s", DM_OBS_PASSWORD: "supersecretpassword" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(true);
    expect(obs.sent[0]?.d).toMatchObject({ authentication: "5gOrKOdQVLVHYGFWP0xfqVdY0ILMPY5tvrfad+rZJAY=" });
    file.clean();
  });

  it("refuses rather than connecting when OBS asks for a password nobody set", async () => {
    const file = scratchFile();
    const obs = fakeObs({ auth: { challenge: "c", salt: "s" }, image: tinyPng(10, 10).toString("base64") });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DM_OBS_PASSWORD");
    expect(obs.sent).toEqual([]);
    file.clean();
  });

  /**
   * OBS photographs a source somebody configured in it; it has no idea what window is in front of
   * them. Asking for one without naming a source has no answer, and saying so beats photographing
   * whatever scene happened to be selected.
   */
  it("refuses when no source was named, since OBS cannot look at the window in front", async () => {
    const file = scratchFile();
    const obs = fakeObs({ image: tinyPng(10, 10).toString("base64") });
    const backend = obsCaptureBackend({ env: {}, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DM_OBS_SOURCE");
    expect(obs.urls).toEqual([]);
    file.clean();
  });

  it("keeps what OBS said when it refused the request", async () => {
    const file = scratchFile();
    const obs = fakeObs({ fail: "No source was found by the name of `KakaoTalk`." });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "KakaoTalk" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("No source was found");
    file.clean();
  });

  it("refuses an answer that is not a picture, rather than writing it to disk", async () => {
    const file = scratchFile();
    const obs = fakeObs({ image: Buffer.from("this is not a png").toString("base64") });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/png/i);
    expect(() => readFileSync(file.path)).toThrow();
    file.clean();
  });

  it("refuses a file name it does not write", async () => {
    const obs = fakeObs({ image: tinyPng(10, 10).toString("base64") });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s" }, connect: obs.factory });
    const result = await backend.capture({ target: { kind: "foreground" }, path: "/tmp/a.jpg" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/png/i);
    expect(obs.urls).toEqual([]);
  });

  it("gives up rather than waiting forever on an OBS that never answers", async () => {
    const file = scratchFile();
    const silent: ObsSocketFactory = () => ({ send() {}, close() {}, addEventListener() {} });
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s" }, connect: silent });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path, timeoutMs: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("30ms");
    file.clean();
  });

  it("says so when the connection fails", async () => {
    const file = scratchFile();
    const broken: ObsSocketFactory = () => {
      throw new Error("ECONNREFUSED 127.0.0.1:4455");
    };
    const backend = obsCaptureBackend({ env: { DM_OBS_SOURCE: "s" }, connect: broken });
    const result = await backend.capture({ target: { kind: "foreground" }, path: file.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ECONNREFUSED");
    file.clean();
  });
});
