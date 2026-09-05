import { describe, it, expect } from "vitest";
import { MAX_IDENTIFIER, emptyWorldState, type MatterEvent } from "@particle/contracts";
import { reduce } from "./index";

/**
 * Every payload string that becomes part of the belief comes through one place, because the
 * sensors are not the only thing that can post an event: the ingest API accepts whatever a client
 * sends. It already cut a name too long to be one. It did not take out control characters, and a
 * name is read back out by capabilities, rendered into cards, written into snapshots and printed
 * to an operator's own terminal — where an escape sequence is an instruction to whatever renders
 * it rather than a name anybody chose.
 */
const ESC = "\u001b";
const T = "2026-09-05T00:00:00Z";

const opened = (path: string): MatterEvent => ({
  id: "e1", sessionId: "s", timestamp: T, source: "user", type: "user.opened_file", severity: "debug", payload: { path },
});
const acted = (key: string): MatterEvent => ({
  id: "e2", sessionId: "s", timestamp: T, source: "user", type: "user.action", severity: "debug", payload: { key },
});

const fileAfter = (path: string) => reduce(emptyWorldState("s", T), opened(path)).environment.files?.[0];
const keyAfter = (key: string) => reduce(emptyWorldState("s", T), acted(key)).behavior.lastActionKey;

describe("a name on its way into the belief", () => {
  it("arrives as itself when it is already a name", () => {
    expect(fileAfter("src/routes.ts")).toBe("src/routes.ts");
    expect(keyAfter("branch:main")).toBe("branch:main");
    expect(fileAfter("site:example.com")).toBe("site:example.com");
    expect(fileAfter("한글/경로.ts")).toBe("한글/경로.ts");
  });

  it("is cut when it is long enough to be prose, visibly", () => {
    const long = fileAfter("a".repeat(10_000))!;
    expect(long.length).toBe(MAX_IDENTIFIER + 1);
    expect(long.endsWith("…")).toBe(true);
  });

  it("leaves its escape sequences at the door", () => {
    expect(fileAfter(`${ESC}[31msrc/routes.ts${ESC}[0m`)).toBe("[31msrc/routes.ts[0m");
    expect(keyAfter(`branch:${ESC}[2Jmain`)).toBe("branch:[2Jmain");
  });

  it("carries no control character at all, whichever one it was", () => {
    for (let code = 0; code < 0xa0; code++) {
      if (code >= 0x20 && code < 0x7f) continue;
      const char = String.fromCharCode(code);
      expect(fileAfter(`a${char}b`), `U+${code.toString(16)}`).toBe("ab");
    }
  });

  it("is cut by what it says, not by what it was sent as", () => {
    // control characters come out first, so a name padded with them is not cut short by padding
    const padded = "\u0000".repeat(500) + "b".repeat(30);
    expect(fileAfter(padded)).toBe("b".repeat(30));
  });

  it("is nothing at all when it is not a string", () => {
    for (const value of [undefined, null, 7, {}, []]) {
      const state = reduce(emptyWorldState("s", T), {
        id: "e", sessionId: "s", timestamp: T, source: "user", type: "user.opened_file", severity: "debug",
        payload: { path: value },
      } as MatterEvent);
      expect(state.environment.files ?? [], JSON.stringify(value) ?? "undefined").toEqual([]);
    }
  });
});
