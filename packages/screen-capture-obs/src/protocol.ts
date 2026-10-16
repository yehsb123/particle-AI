/**
 * obs-websocket v5, the part of it this package speaks.
 *
 * Copyright (C) 2026 Particle AI contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 * See the LICENSE file beside this package. This package is NOT under the repository's MIT
 * licence, and nothing under that licence imports it.
 *
 * Everything below follows obs-websocket's own protocol document
 * (docs/generated/protocol.md in obsproject/obs-websocket): the `{op, d}` envelope, the
 * Hello → Identify → Identified handshake, the Request/RequestResponse pair, and the two-step
 * authentication hash. None of it is guessed at.
 *
 * It is a protocol, not a library: this file links no OBS code and bundles no OBS binary.
 */
import { createHash } from "node:crypto";

/** The opcodes this client uses. The protocol has more; it needs these four. */
export const OBS_OPCODE = { hello: 0, identify: 1, identified: 2, request: 6, requestResponse: 7 } as const;

/** The RPC version this client speaks. obs-websocket 5.x negotiates version 1. */
export const OBS_RPC_VERSION = 1;

/** EventSubscription::None. This client asks for one picture and wants no event stream. */
export const OBS_NO_EVENTS = 0;

/** The request that hands back a picture of one source. */
export const OBS_SCREENSHOT_REQUEST = "GetSourceScreenshot";

export type ObsMessage = { op: number; d: Record<string, unknown> };

/** One message off the socket, or nothing when it is not one. */
export function parseObsMessage(text: unknown): ObsMessage | null {
  if (typeof text !== "string" || !text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const message = parsed as Record<string, unknown>;
  if (typeof message.op !== "number") return null;
  const data = message.d;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return { op: message.op, d: data as Record<string, unknown> };
}

export type ObsHello = {
  rpcVersion: number;
  obsVersion: string;
  obsWebSocketVersion: string;
  /** Absent from Hello when the server wants no password, which the protocol says it may be. */
  authentication: { challenge: string; salt: string } | null;
};

/** The greeting, or nothing when this message is not one. */
export function readHello(message: ObsMessage | null): ObsHello | null {
  if (!message || message.op !== OBS_OPCODE.hello) return null;
  const d = message.d;
  if (typeof d.rpcVersion !== "number") return null;
  const auth = d.authentication;
  let authentication: ObsHello["authentication"] = null;
  if (typeof auth === "object" && auth !== null) {
    const { challenge, salt } = auth as Record<string, unknown>;
    if (typeof challenge === "string" && typeof salt === "string") authentication = { challenge, salt };
  }
  return {
    rpcVersion: d.rpcVersion,
    obsVersion: typeof d.obsStudioVersion === "string" ? d.obsStudioVersion : "",
    obsWebSocketVersion: typeof d.obsWebSocketVersion === "string" ? d.obsWebSocketVersion : "",
    authentication,
  };
}

function sha256Base64(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/**
 * The string that proves this client knows the password, without sending it.
 *
 * base64(sha256(password + salt)) is the secret; base64(sha256(secret + challenge)) is what goes
 * on the wire. The challenge changes per connection, so what is sent is good once.
 */
export function authenticationString(password: string, salt: string, challenge: string): string {
  return sha256Base64(sha256Base64(password + salt) + challenge);
}

export type ObsIdentify = { op: number; d: Record<string, unknown> };

/**
 * The answer to a greeting.
 *
 * A server that asked for a password and a client that has none is refused here rather than on
 * the wire: OBS answers an empty authentication string by closing the socket with a code, which
 * is a worse thing to read than the name of the variable nobody filled in.
 */
export function identifyMessage(hello: ObsHello, password: string): ObsIdentify {
  const d: Record<string, unknown> = { rpcVersion: OBS_RPC_VERSION, eventSubscriptions: OBS_NO_EVENTS };
  if (hello.authentication) {
    if (!password) {
      throw new Error("this OBS asks for a password and DM_OBS_PASSWORD is empty");
    }
    d.authentication = authenticationString(password, hello.authentication.salt, hello.authentication.challenge);
  }
  return { op: OBS_OPCODE.identify, d };
}

export function requestMessage(requestType: string, requestId: string, requestData?: Record<string, unknown>): ObsMessage {
  const d: Record<string, unknown> = { requestType, requestId };
  if (requestData) d.requestData = requestData;
  return { op: OBS_OPCODE.request, d };
}

/**
 * What to ask for a picture of.
 *
 * `sourceName` is a source or a scene as OBS has it configured — a Window Capture pointed at the
 * window somebody wants. This package names no source of its own and creates none: it photographs
 * what the person already set up in OBS.
 */
export function screenshotRequestData(sourceName: string, imageFormat = "png"): Record<string, unknown> {
  return { sourceName, imageFormat };
}

export type ObsRequestResponse = {
  requestId: string;
  requestType: string;
  ok: boolean;
  code: number;
  comment: string;
  data: Record<string, unknown>;
};

/** An answer to a request, or nothing when this message is not one. */
export function readRequestResponse(message: ObsMessage | null): ObsRequestResponse | null {
  if (!message || message.op !== OBS_OPCODE.requestResponse) return null;
  const d = message.d;
  const status = d.requestStatus;
  if (typeof status !== "object" || status === null) return null;
  const { result, code, comment } = status as Record<string, unknown>;
  const data = d.responseData;
  return {
    requestId: typeof d.requestId === "string" ? d.requestId : "",
    requestType: typeof d.requestType === "string" ? d.requestType : "",
    ok: result === true,
    code: typeof code === "number" ? code : 0,
    comment: typeof comment === "string" ? comment : "",
    data: typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
  };
}

/**
 * The picture, decoded.
 *
 * The protocol calls this field base64. Some builds put a data-URI header in front of it, and
 * base64 of a PNG never begins with `data:`, so a header is a header and is dropped rather than
 * written into the file as if it were pixels.
 */
export function decodeImage(imageData: unknown): Buffer | null {
  if (typeof imageData !== "string") return null;
  const trimmed = imageData.trim();
  if (!trimmed) return null;
  const base64 = trimmed.startsWith("data:") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  if (!base64) return null;
  const bytes = Buffer.from(base64, "base64");
  return bytes.length > 0 ? bytes : null;
}
