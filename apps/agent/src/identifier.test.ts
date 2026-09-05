import { describe, it, expect } from "vitest";
import { MAX_IDENTIFIER } from "@particle/contracts";
import { identifier, MAX_NAME, branchFromHead } from "./shape";

/**
 * The agent reports names it read off this machine: a path from the OS watcher, a branch out of
 * the file git wrote. Neither is bounded at the source, and neither used to be bounded here — a
 * branch name of any length went out as an event, and a name carrying an escape sequence went to
 * the runtime, into cards someone reads, and into this process's own stderr, where it is an
 * instruction to their terminal rather than a name anybody chose.
 */
const ESC = "\u001b";
const BELL = "\u0007";

describe("what this sensor will send as a name", () => {
  it("keeps the bound the runtime keeps", () => {
    // a name is trimmed on both sides on purpose; the two sides must agree on where
    expect(MAX_NAME).toBe(MAX_IDENTIFIER);
  });

  it("passes an ordinary name through untouched", () => {
    for (const name of ["main", "src/routes.ts", "feature/login", "한글브랜치", "release-2.1"]) {
      expect(identifier(name), name).toBe(name);
    }
  });

  it("trims a name too long to be a shape, and says it trimmed it", () => {
    const long = identifier("a".repeat(10_000));
    expect(long.length).toBeLessThanOrEqual(MAX_NAME + 1);
    expect(long.endsWith("…")).toBe(true);
    expect(identifier("a".repeat(MAX_NAME))).toBe("a".repeat(MAX_NAME));
  });

  it("takes the escape sequences out", () => {
    expect(identifier(`${ESC}[31mred${ESC}[0m`)).toBe("[31mred[0m");
    expect(identifier(`${BELL}bell`)).toBe("bell");
    // a control character is removed, not turned into a space, exactly as the world model does
    expect(identifier("line\nbreak")).toBe("linebreak");
    expect(identifier("tab\tstop")).toBe("tabstop");
    expect(identifier("two  spaces")).toBe("two spaces");
  });

  it("says nothing about a name that is not one", () => {
    for (const value of [undefined, null, 7, {}, [], true, "", "   "]) {
      expect(identifier(value), JSON.stringify(value) ?? "undefined").toBe("");
    }
  });

  it("never leaves a control character behind, whatever it was handed", () => {
    for (let code = 0; code < 0xa0; code++) {
      if (code >= 0x20 && code < 0x7f) continue;
      expect(identifier(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).not.toContain(String.fromCharCode(code));
    }
  });
});

describe("the branch this machine is on", () => {
  it("is read out of a HEAD that points at one", () => {
    expect(branchFromHead("ref: refs/heads/main\n")).toBe("main");
    expect(branchFromHead("ref: refs/heads/feature/login")).toBe("feature/login");
  });

  it("is the short commit when HEAD is detached", () => {
    expect(branchFromHead("deadbeefdeadbeef")).toBe("detached@deadbee");
  });

  it("is nothing when HEAD says nothing this sensor understands", () => {
    for (const head of ["", "   ", "ref: refs/tags/v1", "not a head", "ref: refs/heads/"]) {
      expect(branchFromHead(head), JSON.stringify(head)).toBeUndefined();
    }
  });

  it("is nothing when HEAD is not text at all", () => {
    // the file is read off disk; a read that answers with something else must not throw here
    for (const value of [undefined, null, 7, {}, []]) {
      expect(branchFromHead(value), JSON.stringify(value) ?? "undefined").toBeUndefined();
    }
  });

  it("is trimmed to a shape however long the branch name is", () => {
    const branch = branchFromHead(`ref: refs/heads/${"b".repeat(50_000)}`)!;
    expect(branch.length).toBeLessThanOrEqual(MAX_NAME + 1);
  });

  it("carries no escape sequence out of the file git wrote", () => {
    expect(branchFromHead(`ref: refs/heads/${ESC}[31mmain`)).toBe("[31mmain");
    expect(branchFromHead(`ref: refs/heads/a${BELL}b`)).toBe("ab");
  });

  it("is nothing when the name is only an escape sequence", () => {
    expect(branchFromHead(`ref: refs/heads/${ESC}`)).toBeUndefined();
  });
});
