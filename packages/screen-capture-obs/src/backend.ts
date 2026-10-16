/**
 * The OBS capture backend.
 *
 * Copyright (C) 2026 Particle AI contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later — see the LICENSE file beside this package.
 *
 * It implements the backend interface from `@particle/screen-capture` (MIT). The dependency runs
 * one way only: GPL may use MIT, MIT may never reach for GPL, and `boundary.test.ts` over there
 * reads every file in the repository on every run to keep it that way.
 *
 * Nothing here links OBS. It opens a WebSocket to an obs-websocket server the person started
 * themselves and asks it, over the documented protocol, for one picture of one source.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CaptureBackend, CaptureRequest, CaptureResult } from "@particle/screen-capture";
import {
  OBS_SCREENSHOT_REQUEST,
  decodeImage,
  identifyMessage,
  parseObsMessage,
  readHello,
  readRequestResponse,
  requestMessage,
  screenshotRequestData,
  OBS_OPCODE,
} from "./protocol";
import { pngSize } from "./png";

/** Where obs-websocket listens when nobody changed it. */
export const DEFAULT_OBS_URL = "ws://127.0.0.1:4455";

const DEFAULT_TIMEOUT_MS = 15_000;

export type ObsConfig = { url: string; password: string; source: string };

/**
 * What this backend reads from the environment.
 *
 * `DM_OBS_PASSWORD` is a secret and belongs in `.env`, never in a commit. `DM_OBS_SOURCE` names a
 * source or scene already configured in OBS — this package creates none and renames none.
 */
export function readObsConfig(env: Record<string, string | undefined>): ObsConfig {
  const url = (env.DM_OBS_URL ?? "").trim() || DEFAULT_OBS_URL;
  if (!/^wss?:\/\//.test(url)) {
    throw new Error(`DM_OBS_URL must be a ws:// or wss:// address; got ${JSON.stringify(url)}`);
  }
  return { url, password: (env.DM_OBS_PASSWORD ?? "").trim(), source: (env.DM_OBS_SOURCE ?? "").trim() };
}

/** The part of a WebSocket this client uses. A structural type, so a test can be the other end. */
export type ObsSocket = {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
};

export type ObsSocketFactory = (url: string) => ObsSocket;

export type ObsBackendOptions = {
  env?: Record<string, string | undefined>;
  /** How the socket is opened. The default is the runtime's own WebSocket. */
  connect?: ObsSocketFactory;
};

/**
 * The runtime's WebSocket, which Node has had as a global since 22.
 *
 * Refused by name rather than by a TypeError from somewhere inside the connect, because "this
 * Node has no WebSocket" is a thing somebody can act on and "undefined is not a constructor" is
 * not.
 */
function defaultConnect(url: string): ObsSocket {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (!Ctor) {
    throw new Error("this Node has no WebSocket; Node 22 or later has one, or pass your own `connect`");
  }
  return new Ctor(url) as ObsSocket;
}

export function obsCaptureBackend(options: ObsBackendOptions = {}): CaptureBackend {
  const env = options.env ?? process.env;
  const connect = options.connect ?? defaultConnect;
  return {
    name: "obs",
    async capture(request: CaptureRequest): Promise<CaptureResult> {
      let config: ObsConfig;
      try {
        config = readObsConfig(env);
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
      const path = request.path.trim();
      if (!path || !/\.png$/i.test(path)) {
        return { ok: false, reason: `the file to write must end in .png; got ${JSON.stringify(request.path)}` };
      }
      // OBS photographs a source somebody configured in it. It has no notion of the window in
      // front, so there is nothing to fall back to and nothing worth guessing at.
      const source = request.target.kind === "app" ? request.target.app.trim() : config.source;
      if (!source) {
        return {
          ok: false,
          reason: "OBS photographs a source you configured in it, not the window in front; name one in DM_OBS_SOURCE or ask for a target of kind app",
        };
      }
      return talk(config, source, path, request.timeoutMs ?? DEFAULT_TIMEOUT_MS, connect);
    },
  };
}

function talk(config: ObsConfig, source: string, path: string, timeoutMs: number, connect: ObsSocketFactory): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let socket: ObsSocket;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CaptureResult): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      try { socket.close(); } catch { /* already gone */ }
      resolve(result);
    };
    const refuse = (reason: string): void => finish({ ok: false, reason });

    try {
      socket = connect(config.url);
    } catch (err) {
      resolve({ ok: false, reason: `cannot reach OBS at ${config.url}: ${(err as Error).message}` });
      return;
    }

    deadline = setTimeout(() => refuse(`OBS at ${config.url} did not answer within ${timeoutMs}ms`), timeoutMs);
    const requestId = `particle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    socket.addEventListener("error", () => refuse(`the connection to OBS at ${config.url} failed`));
    socket.addEventListener("close", () => refuse(`OBS at ${config.url} closed the connection before answering`));
    socket.addEventListener("message", (event) => {
      const message = parseObsMessage(typeof event.data === "string" ? event.data : String(event.data ?? ""));
      if (!message) return;

      const hello = readHello(message);
      if (hello) {
        try {
          socket.send(JSON.stringify(identifyMessage(hello, config.password)));
        } catch (err) {
          refuse((err as Error).message);
        }
        return;
      }

      if (message.op === OBS_OPCODE.identified) {
        socket.send(JSON.stringify(requestMessage(OBS_SCREENSHOT_REQUEST, requestId, screenshotRequestData(source))));
        return;
      }

      const answer = readRequestResponse(message);
      if (!answer || answer.requestId !== requestId) return;
      if (!answer.ok) {
        refuse(`OBS refused ${answer.requestType} (${answer.code})${answer.comment ? `: ${answer.comment}` : ""}`);
        return;
      }
      const bytes = decodeImage(answer.data.imageData);
      if (!bytes) {
        refuse("OBS answered without a picture in it");
        return;
      }
      const size = pngSize(bytes);
      if (!size) {
        // never write bytes nobody could read back as the picture this promised
        refuse("what OBS handed back is not a png");
        return;
      }
      try {
        const dir = dirname(path);
        if (dir) mkdirSync(dir, { recursive: true });
        writeFileSync(path, bytes);
      } catch (err) {
        refuse(`the picture could not be written to ${path}: ${(err as Error).message}`);
        return;
      }
      finish({
        ok: true,
        frame: {
          path,
          format: "png",
          width: size.width,
          height: size.height,
          bytes: bytes.length,
          // the program is OBS; the source name is what this picture is OF
          app: "obs",
          window: source,
          capturedAt: new Date().toISOString(),
          backend: "obs",
        },
      });
    });
  });
}
