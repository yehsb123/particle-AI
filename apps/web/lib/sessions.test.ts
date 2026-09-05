import { describe, it, expect } from "vitest";
import { SessionSummary } from "@particle/contracts";
import { parseSessions, sessionHref } from "./runtimeClient";

/**
 * The rail in one session's body lists the other sessions this runtime senses, and links to each.
 *
 * Two things were wrong with it. The listing was cast, and the rail reads a layer list off every
 * entry — reading `.length` off something that is not a list throws inside the render, which takes
 * the whole body down rather than one row. And the link it built dropped the token: the extension
 * side panel passes one in the page's address, because a page cannot read the extension's storage,
 * so following a link opened a body that could no longer reach the runtime at all, silently.
 *
 * The shape itself now lives in the contracts. The runtime built it and the body read it back,
 * each describing it separately, so a field either side changed was one the other believed in.
 */
const SESSION = { sessionId: "ext", intent: "debugging", problems: 1, layers: ["tabs", "network"] };

describe("the sessions this runtime senses", () => {
  it("come back as the runtime described them", () => {
    expect(parseSessions({ sessions: [SESSION] })).toEqual([SESSION]);
  });

  it("are nothing at all when the answer is not a listing", () => {
    for (const junk of [null, undefined, 42, "none", [], {}, { sessions: "none" }, { sessions: null }]) {
      expect(parseSessions(junk), JSON.stringify(junk) ?? "undefined").toEqual([]);
    }
  });

  it("fill in what an older runtime did not send", () => {
    expect(parseSessions({ sessions: [{ sessionId: "a" }] })).toEqual([{ sessionId: "a", problems: 0, layers: [] }]);
  });

  it("keep a session whose fields are wrong, because the session still exists", () => {
    // emptying the rail would say "no other sessions", which is a confident lie; saying a session
    // reports nothing is a quiet one
    const parsed = parseSessions({ sessions: [{ sessionId: "ext", layers: "tabs", problems: "many", intent: {} }] });
    expect(parsed).toEqual([{ sessionId: "ext", problems: 0, layers: [] }]);
  });

  it("keep the layers that are layers", () => {
    const parsed = parseSessions({ sessions: [{ sessionId: "ext", layers: ["tabs", 7, null, "idle"] }] });
    expect(parsed[0]?.layers).toEqual(["tabs", "idle"]);
  });

  it("drop an entry that cannot even be named", () => {
    expect(parseSessions({ sessions: [SESSION, null, "a session", {}, { sessionId: "" }, 7] })).toEqual([SESSION]);
  });

  it("never report a negative or fractional count of problems", () => {
    for (const [sent, shown] of [[-3, 0], [2.7, 2], [NaN, 0], [Infinity, 0]] as [number, number][]) {
      expect(parseSessions({ sessions: [{ sessionId: "a", problems: sent }] })[0]?.problems, String(sent)).toBe(shown);
    }
  });

  it("are bounded, however many the runtime knows", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({ ...SESSION, sessionId: `s${i}` }));
    expect(parseSessions({ sessions: many }).length).toBeLessThanOrEqual(50);
  });

  it("always come back as something the rail can draw without throwing", () => {
    const hostile = { sessions: [SESSION, null, { sessionId: "b", layers: {} }, { sessionId: "c", layers: [{}] }] };
    for (const s of parseSessions(hostile)) {
      expect(Array.isArray(s.layers), s.sessionId).toBe(true);
      expect(typeof s.problems, s.sessionId).toBe("number");
      expect(() => s.layers.map((l) => l.length), s.sessionId).not.toThrow();
    }
  });

  it("are the shape the contracts describe", () => {
    for (const s of parseSessions({ sessions: [SESSION, { sessionId: "b" }, { sessionId: "c", layers: 7 }] })) {
      expect(SessionSummary.safeParse(s).success, s.sessionId).toBe(true);
    }
  });
});

describe("a link to another session's body", () => {
  it("goes to that session, in connected mode", () => {
    expect(sessionHref("other", "")).toBe("/?connect=1&session=other");
  });

  it("carries the token this page is using, so the next body can still reach the runtime", () => {
    expect(sessionHref("other", "SECRET")).toBe("/?connect=1&session=other&token=SECRET");
  });

  it("carries nothing extra when there is no token", () => {
    expect(sessionHref("other", "")).not.toContain("token");
  });

  it("escapes both, so neither can add a parameter of its own", () => {
    const href = sessionHref("a&connect=0", "b&admin=1");
    expect(href).not.toContain("connect=0");
    expect(href).not.toContain("admin=1");
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("session")).toBe("a&connect=0");
    expect(params.get("token")).toBe("b&admin=1");
    expect(params.get("connect")).toBe("1");
  });

  it("stays on this origin, whatever it is handed", () => {
    for (const id of ["//evil.example.com", "https://evil.example.com", "../elsewhere", "a b"]) {
      expect(sessionHref(id, "").startsWith("/?"), id).toBe(true);
    }
  });

  it("is still a link when the id is not a string", () => {
    for (const id of [undefined, null, 7, {}, []]) {
      expect(() => sessionHref(id, ""), JSON.stringify(id) ?? "undefined").not.toThrow();
      expect(sessionHref(id, "").startsWith("/?connect=1"), JSON.stringify(id) ?? "undefined").toBe(true);
    }
  });
});
