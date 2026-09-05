import { describe, it, expect } from "vitest";
import { runtimeUrlFrom, DEFAULT_RUNTIME_URL } from "./shape";

/**
 * Where this sensor sends what it observes was decided by a prefix test rather than by parsing.
 * So "192.168.1.20:8787" — a reasonable thing to type for a runtime on another machine — fell
 * back to this one, while the options page went on showing what had been typed and the line
 * beneath it printed the default no matter what. Somebody who believes their events are going to
 * one machine while they go to another has been told something untrue about their own data.
 *
 * A URL that parses is used. One that does not falls back and says so.
 */
describe("where the sensor will send what it sees", () => {
  it("is this machine when nobody has said otherwise", () => {
    for (const typed of ["", "   ", undefined, null, 7, {}]) {
      const { url, fellBack } = runtimeUrlFrom(typed);
      expect(url, JSON.stringify(typed) ?? "undefined").toBe(DEFAULT_RUNTIME_URL);
      // nothing was typed, so nothing was refused
      expect(fellBack, JSON.stringify(typed) ?? "undefined").toBe(false);
    }
  });

  it("is the address somebody typed, when it is one", () => {
    expect(runtimeUrlFrom("http://localhost:8787")).toEqual({ url: "http://localhost:8787", fellBack: false });
    expect(runtimeUrlFrom("https://runtime.example.com")).toEqual({ url: "https://runtime.example.com", fellBack: false });
    expect(runtimeUrlFrom("http://192.168.1.20:8787")).toEqual({ url: "http://192.168.1.20:8787", fellBack: false });
  });

  it("forgives a trailing slash and the spaces around it", () => {
    expect(runtimeUrlFrom("  http://localhost:8787/  ").url).toBe("http://localhost:8787");
    expect(runtimeUrlFrom("http://localhost:8787/").url).toBe("http://localhost:8787");
  });

  it("keeps a path somebody meant to include", () => {
    expect(runtimeUrlFrom("https://example.com/particle").url).toBe("https://example.com/particle");
  });

  it("says it fell back rather than quietly sending somewhere else", () => {
    // each of these looks accepted in the box: the page has to be able to say it was not
    for (const typed of ["192.168.1.20:8787", "localhost:8787", "ftp://elsewhere", "javascript:alert(1)", "not a url"]) {
      const { url, fellBack } = runtimeUrlFrom(typed);
      expect(url, typed).toBe(DEFAULT_RUNTIME_URL);
      expect(fellBack, typed).toBe(true);
    }
  });

  it("never answers with something that is not an address", () => {
    // the prefix test let "http://" through and the trailing-slash trim made it "http:/"
    for (const typed of ["http://", "https://", "http:///", "http://:8787"]) {
      const { url } = runtimeUrlFrom(typed);
      expect(() => new URL(url), typed).not.toThrow();
      expect(url.startsWith("http://") || url.startsWith("https://"), typed).toBe(true);
    }
  });

  it("sends nowhere but over http, whatever else was typed", () => {
    for (const typed of ["file:///etc/passwd", "chrome-extension://abc/x", "data:text/plain,hi", "ws://localhost:8787"]) {
      expect(runtimeUrlFrom(typed).url, typed).toBe(DEFAULT_RUNTIME_URL);
    }
  });
});
