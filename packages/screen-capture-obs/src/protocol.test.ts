import { describe, it, expect } from "vitest";
import {
  parseObsMessage,
  readHello,
  authenticationString,
  identifyMessage,
  requestMessage,
  readRequestResponse,
  screenshotRequestData,
  decodeImage,
  OBS_OPCODE,
  OBS_RPC_VERSION,
} from "./protocol";

/**
 * obs-websocket v5, as the protocol document describes it. Every shape here is from that document
 * rather than from memory, and the authentication vector below was computed with an independent
 * implementation (Python's hashlib) so that this test pins the algorithm and not this file's idea
 * of it.
 */
const HELLO_WITH_AUTH = JSON.stringify({
  op: 0,
  d: {
    obsWebSocketVersion: "5.5.2",
    rpcVersion: 1,
    obsStudioVersion: "30.2.2",
    authentication: { challenge: "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=", salt: "82RGdbPHgSNkAZ4aRGEBXNlJfweWQtAgZbxYm5Bg2cw=" },
  },
});

const HELLO_WITHOUT_AUTH = JSON.stringify({
  op: 0,
  d: { obsWebSocketVersion: "5.5.2", rpcVersion: 1, obsStudioVersion: "30.2.2" },
});

describe("reading what OBS sends", () => {
  it("reads a message with an opcode and its data", () => {
    expect(parseObsMessage(HELLO_WITHOUT_AUTH)?.op).toBe(OBS_OPCODE.hello);
  });

  it("has nothing to say about anything that is not one", () => {
    for (const nothing of ["", "not json", "[]", "{}", JSON.stringify({ op: "0", d: {} }), JSON.stringify({ op: 0 }), undefined, 7]) {
      expect(parseObsMessage(nothing), JSON.stringify(nothing) ?? "undefined").toBeNull();
    }
  });

  it("reads a greeting that asks for a password", () => {
    const hello = readHello(parseObsMessage(HELLO_WITH_AUTH));
    expect(hello?.rpcVersion).toBe(1);
    expect(hello?.authentication?.salt).toBe("82RGdbPHgSNkAZ4aRGEBXNlJfweWQtAgZbxYm5Bg2cw=");
  });

  it("reads a greeting that asks for none", () => {
    expect(readHello(parseObsMessage(HELLO_WITHOUT_AUTH))?.authentication).toBeNull();
  });

  it("does not take another opcode for a greeting", () => {
    expect(readHello(parseObsMessage(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })))).toBeNull();
  });
});

describe("the authentication string", () => {
  /**
   * base64(sha256(password + salt)), then base64(sha256(that + challenge)) — the two steps the
   * protocol document gives. The expected value was computed outside this codebase.
   */
  it("is the two hashes the protocol asks for", () => {
    const auth = authenticationString(
      "supersecretpassword",
      "82RGdbPHgSNkAZ4aRGEBXNlJfweWQtAgZbxYm5Bg2cw=",
      "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=",
    );
    expect(auth).toBe("5gOrKOdQVLVHYGFWP0xfqVdY0ILMPY5tvrfad+rZJAY=");
  });

  it("is a different string for a different password, which is the whole point", () => {
    const salt = "82RGdbPHgSNkAZ4aRGEBXNlJfweWQtAgZbxYm5Bg2cw=";
    const challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";
    expect(authenticationString("a", salt, challenge)).not.toBe(authenticationString("b", salt, challenge));
  });
});

describe("what this client says back", () => {
  it("identifies without a password when none was asked for", () => {
    const hello = readHello(parseObsMessage(HELLO_WITHOUT_AUTH));
    const message = identifyMessage(hello!, "");
    expect(message.op).toBe(OBS_OPCODE.identify);
    expect(message.d.rpcVersion).toBe(OBS_RPC_VERSION);
    expect("authentication" in message.d).toBe(false);
  });

  /**
   * This client is here to ask for one picture. Subscribing to events would make OBS stream
   * everything it does at a process that reads none of it, so it asks for none: EventSubscription
   * None is 0.
   */
  it("subscribes to nothing", () => {
    const hello = readHello(parseObsMessage(HELLO_WITHOUT_AUTH));
    expect(identifyMessage(hello!, "").d.eventSubscriptions).toBe(0);
  });

  it("identifies with the computed string when a password was asked for", () => {
    const hello = readHello(parseObsMessage(HELLO_WITH_AUTH));
    expect(identifyMessage(hello!, "supersecretpassword").d.authentication).toBe("5gOrKOdQVLVHYGFWP0xfqVdY0ILMPY5tvrfad+rZJAY=");
  });

  /** Sending an empty authentication string would be refused by OBS with nothing to explain it. */
  it("refuses to identify without the password OBS asked for", () => {
    const hello = readHello(parseObsMessage(HELLO_WITH_AUTH));
    expect(() => identifyMessage(hello!, "")).toThrow(/DM_OBS_PASSWORD/);
  });

  it("asks a request by type and id", () => {
    const message = requestMessage("GetVersion", "r1");
    expect(message.op).toBe(OBS_OPCODE.request);
    expect(message.d).toEqual({ requestType: "GetVersion", requestId: "r1" });
  });

  it("carries request data when there is any", () => {
    const message = requestMessage("GetSourceScreenshot", "r2", screenshotRequestData("KakaoTalk"));
    expect(message.d.requestData).toEqual({ sourceName: "KakaoTalk", imageFormat: "png" });
  });
});

describe("reading an answer to a request", () => {
  const response = (d: Record<string, unknown>): string => JSON.stringify({ op: OBS_OPCODE.requestResponse, d });

  it("reads a request that worked", () => {
    const read = readRequestResponse(parseObsMessage(response({
      requestType: "GetSourceScreenshot",
      requestId: "r2",
      requestStatus: { result: true, code: 100 },
      responseData: { imageData: "AAAA" },
    })));
    expect(read).toEqual({ requestId: "r2", requestType: "GetSourceScreenshot", ok: true, code: 100, comment: "", data: { imageData: "AAAA" } });
  });

  it("reads a request that did not, and keeps what OBS said about it", () => {
    const read = readRequestResponse(parseObsMessage(response({
      requestType: "GetSourceScreenshot",
      requestId: "r2",
      requestStatus: { result: false, code: 600, comment: "No source was found by the name of `KakaoTalk`." },
    })));
    expect(read?.ok).toBe(false);
    expect(read?.comment).toContain("KakaoTalk");
  });

  it("does not take another opcode for an answer", () => {
    expect(readRequestResponse(parseObsMessage(HELLO_WITHOUT_AUTH))).toBeNull();
  });
});

describe("the picture OBS hands back", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("decodes the base64 the protocol describes", () => {
    expect(decodeImage(png.toString("base64"))?.equals(png)).toBe(true);
  });

  /** base64 of a PNG never begins with `data:`, so a data-URI header is a header, not pixels. */
  it("decodes it with a data-URI header in front of it too", () => {
    expect(decodeImage(`data:image/png;base64,${png.toString("base64")}`)?.equals(png)).toBe(true);
  });

  it("has nothing to say about what is not an image", () => {
    for (const nothing of ["", "   ", undefined, null, 7, "data:image/png;base64,"]) {
      expect(decodeImage(nothing), JSON.stringify(nothing) ?? "undefined").toBeNull();
    }
  });
});
