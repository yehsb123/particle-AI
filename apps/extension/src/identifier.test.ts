import { describe, it, expect } from "vitest";
import { MAX_IDENTIFIER } from "@particle/contracts";
import { identifier, MAX_NAME, hostOf } from "./shape";

/**
 * The extension reports the host of a page, never its address and never its content. A URL parses
 * with a hostname of any length, so what this sensor called a shape was whatever the page happened
 * to be served from. The bound the agent keeps and the runtime keeps applies here too.
 */
const ESC = "\u001b";

describe("what this sensor will send as a name", () => {
  it("keeps the bound the runtime keeps", () => {
    expect(MAX_NAME).toBe(MAX_IDENTIFIER);
  });

  it("passes an ordinary host through untouched", () => {
    for (const name of ["example.com", "docs.internal.example.com", "localhost"]) {
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
    // a control character is removed, not turned into a space, exactly as the world model does
    expect(identifier("line\nbreak")).toBe("linebreak");
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

describe("the host a page was served from", () => {
  it("is the hostname, never the rest of the address", () => {
    expect(hostOf("https://example.com/private/path?token=secret")).toBe("example.com");
    expect(hostOf("http://localhost:3000/x")).toBe("localhost");
  });

  it("is unknown when there is no address to read", () => {
    for (const url of ["", "not a url", "about:blank"]) {
      expect(hostOf(url), JSON.stringify(url)).toBe("unknown");
    }
  });

  it("is trimmed however long the hostname is", () => {
    const host = hostOf(`https://${"a".repeat(5_000)}.example.com/`);
    expect(host.length).toBeLessThanOrEqual(MAX_NAME + 1);
    expect(host).not.toBe("unknown");
  });
});
