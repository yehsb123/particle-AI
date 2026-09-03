import { describe, it, expect } from "vitest";
import { hostOf, isSelfHost, isSensableUrl, isTransientError, networkSeverity, consentLayers, NetworkShaper, DEFAULT_CONSENT } from "./shape";

/**
 * Everything the extension can possibly send is derived in shape.ts, so its edges are the privacy
 * boundary. These tests use the inputs a browser really hands over — credentials in the URL, IPv6
 * hosts in brackets, odd status codes, cancelled requests — and pin that nothing but a hostname,
 * a status and a duration can come out.
 */
describe("hostOf — a hostname and nothing else", () => {
  it("drops credentials, port, path, query and hash", () => {
    expect(hostOf("https://user:pw@api.example.com:8443/v1/users?token=abc#frag")).toBe("api.example.com");
  });

  it("keeps an IPv6 host in the bracket form the browser uses", () => {
    expect(hostOf("https://[2001:db8::1]:8443/x")).toBe("[2001:db8::1]");
  });

  it("lowercases the host, so the same site is one entity", () => {
    expect(hostOf("http://Example.COM/a")).toBe(hostOf("http://example.com/b"));
  });

  it("answers 'unknown' for anything that is not a URL, and never throws", () => {
    for (const bad of ["", "   ", "not a url", "http://", "://x", "javascript:alert(1)"]) {
      expect(typeof hostOf(bad)).toBe("string");
    }
    expect(hostOf("")).toBe("unknown");
    expect(hostOf("not a url")).toBe("unknown");
  });
});

describe("isSelfHost — the whole loopback family", () => {
  it("recognises every spelling of this machine", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0:0:0:0:0:0:0:1"]) {
      expect(isSelfHost(h), h).toBe(true);
    }
  });

  it("does not mistake a real site for us", () => {
    for (const h of ["example.com", "127.example.com", "1270.0.0.1", "localhost.evil.com", "0.0.0.0", ""]) {
      expect(isSelfHost(h), h).toBe(false);
    }
  });
});

describe("isSensableUrl — only the web is observed", () => {
  it("accepts http and https", () => {
    expect(isSensableUrl("http://a.b/c")).toBe(true);
    expect(isSensableUrl("https://a.b/c")).toBe(true);
  });

  it("refuses our own pages, browser internals, files and everything else", () => {
    for (const u of ["chrome-extension://abc/sidepanel.html", "chrome://extensions", "about:blank", "file:///C:/x.html", "devtools://devtools/x", "data:text/html,x", "ws://a.b", "", "https:/a"]) {
      expect(isSensableUrl(u), u).toBe(false);
    }
  });
});

describe("networkSeverity — only a real failure is a warning", () => {
  it("warns on 5xx and on a transport error, stays informational otherwise", () => {
    const cases: [number | undefined, boolean | undefined, "info" | "warning"][] = [
      [200, undefined, "info"],
      [304, undefined, "info"],
      [404, undefined, "info"],
      [499, undefined, "info"],
      [500, undefined, "warning"],
      [503, undefined, "warning"],
      [599, undefined, "warning"],
      [0, undefined, "info"],
      [undefined, undefined, "info"],
      [200, true, "warning"],
    ];
    for (const [status, error, expected] of cases) {
      expect(networkSeverity({ host: "h", status, error }), `${status}/${error}`).toBe(expected);
    }
  });
});

describe("isTransientError — normal browsing is not a failing dependency", () => {
  it("ignores cancelled, blocked and cache-related outcomes", () => {
    for (const e of ["net::ERR_ABORTED", "net::ERR_BLOCKED_BY_CLIENT", "net::ERR_BLOCKED_BY_ORB", "net::ERR_BLOCKED_BY_RESPONSE", "net::ERR_CACHE_MISS", "net::ERR_INCOMPLETE_CHUNKED_ENCODING"]) {
      expect(isTransientError(e), e).toBe(true);
    }
  });

  it("treats a genuine connection problem as real", () => {
    for (const e of ["net::ERR_CONNECTION_REFUSED", "net::ERR_NAME_NOT_RESOLVED", "net::ERR_TIMED_OUT", "", undefined]) {
      expect(isTransientError(e), String(e)).toBe(false);
    }
  });
});

describe("consentLayers — the indicator can only say what consent allows", () => {
  it("maps each switch to the layers it enables", () => {
    expect(consentLayers({ interactions: true, tabs: false, network: false })).toEqual(["interactions", "idle", "visibility"]);
    expect(consentLayers({ interactions: false, tabs: true, network: false })).toEqual(["tabs"]);
    expect(consentLayers({ interactions: false, tabs: false, network: true })).toEqual(["network"]);
    expect(consentLayers({ interactions: true, tabs: true, network: true })).toEqual(["interactions", "idle", "visibility", "tabs", "network"]);
    expect(consentLayers({ interactions: false, tabs: false, network: false })).toEqual([]);
  });

  it("ships with traffic sensing off — the widest layer is opt-in", () => {
    expect(DEFAULT_CONSENT.network).toBe(false);
    expect(consentLayers(DEFAULT_CONSENT)).not.toContain("network");
  });
});

describe("NetworkShaper — transitions only, and a bounded memory", () => {
  const shaper = () => new NetworkShaper({ failureCooldownMs: 1_000, slowMs: 2_000, successSampleMs: 5_000, maxHosts: 3 });

  it("reports a failure once per cooldown per host, independently of other hosts", () => {
    const s = shaper();
    expect(s.admit({ host: "a", status: 503 }, 0)).toBe("failure");
    expect(s.admit({ host: "a", status: 503 }, 500)).toBeNull();
    expect(s.admit({ host: "b", status: 500 }, 500)).toBe("failure"); // a different host is its own story
    expect(s.admit({ host: "a", status: 503 }, 1_000)).toBe("failure"); // cooldown elapsed
  });

  it("treats any answer under 400 as the host being back", () => {
    for (const status of [200, 204, 301, 399]) {
      const s = shaper();
      s.admit({ host: "a", status: 503 }, 0);
      expect(s.admit({ host: "a", status }, 100), String(status)).toBe("recovery");
    }
  });

  it("ignores redirects and client errors when nothing was failing", () => {
    const s = shaper();
    expect(s.admit({ host: "a", status: 302 }, 0)).toBeNull();
    expect(s.admit({ host: "a", status: 404 }, 0)).toBeNull();
    expect(s.admit({ host: "a", status: 0 }, 0)).toBeNull(); // a status of zero says nothing
  });

  it("flags slowness at the threshold and samples ordinary successes sparsely", () => {
    const s = shaper();
    expect(s.admit({ host: "slow", status: 200, ms: 2_000 }, 0)).toBe("slow");
    expect(s.admit({ host: "fast", status: 200, ms: 1_999 }, 0)).toBe("sample");
    expect(s.admit({ host: "fast", status: 200, ms: 10 }, 4_999)).toBeNull(); // inside the window
    expect(s.admit({ host: "fast", status: 200, ms: 10 }, 5_000)).toBe("sample");
  });

  it("forgets the oldest hosts instead of growing forever", () => {
    const s = shaper();
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) s.admit({ host: h, status: 200 }, 0);
    expect(s.admit({ host: "h1", status: 200 }, 1)).toBe("sample"); // h1 was pruned, so it samples again
  });

  it("never reports anything but the four transition kinds", () => {
    const s = shaper();
    const seen = new Set<string | null>();
    let t = 0;
    for (const status of [503, 503, 200, 404, 302, 500, 200, 200]) seen.add(s.admit({ host: "x", status, ms: 3_000 }, (t += 1_200)));
    for (const kind of seen) expect([null, "failure", "recovery", "slow", "sample"]).toContain(kind);
  });
});
