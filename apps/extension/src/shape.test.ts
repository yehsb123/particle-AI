import { describe, it, expect } from "vitest";
import { hostOf, networkSeverity, matterEvent, isSelfHost, isSensableUrl, DEFAULT_CONSENT, NetworkShaper, isTransientError, consentLayers } from "./shape";

describe("extension shaping (privacy)", () => {
  it("keeps only the hostname — never path, query, hash, credentials or port", () => {
    expect(hostOf("https://user:pw@api.example.com:8443/v1/users?id=42&token=abc#x")).toBe("api.example.com");
    expect(hostOf("not a url")).toBe("unknown");
  });
  it("classifies severity by failure, not by content", () => {
    expect(networkSeverity({ host: "h", status: 200 })).toBe("info");
    expect(networkSeverity({ host: "h", status: 503 })).toBe("warning");
    expect(networkSeverity({ host: "h", error: true })).toBe("warning");
  });
  it("builds a MatterEvent-shaped payload with a session and ISO time", () => {
    const e = matterEvent("ext", "sensor", "network.request", "info", { host: "h" }, new Date("2026-08-31T00:00:00Z"));
    expect(e.sessionId).toBe("ext");
    expect(e.timestamp).toBe("2026-08-31T00:00:00.000Z");
    expect(e.type).toBe("network.request");
  });
  it("only the web is sensable — the extension never observes its own pages or browser internals", () => {
    expect(isSensableUrl("https://example.com/a")).toBe(true);
    expect(isSensableUrl("http://example.test/")).toBe(true);
    expect(isSensableUrl("chrome-extension://abcdef/sidepanel.html")).toBe(false);
    expect(isSensableUrl("chrome://extensions")).toBe(false);
    expect(isSensableUrl("file:///C:/x.html")).toBe(false);
    expect(isSensableUrl("about:blank")).toBe(false);
  });
  it("never observes the runtime/body itself; network sensing is opt-in by default", () => {
    expect(isSelfHost("localhost")).toBe(true);
    expect(isSelfHost("api.example.com")).toBe(false);
    expect(DEFAULT_CONSENT.network).toBe(false);
  });
  it("announces exactly the layers consent enables (the indicator can only be honest)", () => {
    expect(consentLayers(DEFAULT_CONSENT)).toEqual(["interactions", "idle", "visibility", "tabs"]);
    expect(consentLayers({ interactions: false, tabs: false, network: true })).toEqual(["network"]);
    expect(consentLayers({ interactions: false, tabs: false, network: false })).toEqual([]);
  });
});

describe("NetworkShaper (transitions, not a firehose)", () => {
  const s = () => new NetworkShaper({ failureCooldownMs: 5_000, slowMs: 2_000, successSampleMs: 30_000, maxHosts: 3 });

  it("reports a failure once per cooldown, then the recovery of that host", () => {
    const sh = s();
    expect(sh.admit({ host: "api", status: 503 }, 0)).toBe("failure");
    expect(sh.admit({ host: "api", status: 503 }, 1_000)).toBeNull(); // same host, inside cooldown
    expect(sh.admit({ host: "api", status: 500 }, 6_000)).toBe("failure"); // still failing after cooldown
    expect(sh.admit({ host: "api", status: 200 }, 7_000)).toBe("recovery");
    expect(sh.admit({ host: "api", status: 200 }, 7_100)).toBeNull(); // ordinary success is sampled, not streamed
  });

  it("samples ordinary successes once per host per window; slowness is flagged", () => {
    const sh = s();
    expect(sh.admit({ host: "cdn", status: 200, ms: 50 }, 0)).toBe("sample");
    for (let t = 1; t < 30; t++) expect(sh.admit({ host: "cdn", status: 200, ms: 50 }, t * 1_000)).toBeNull();
    expect(sh.admit({ host: "cdn", status: 200, ms: 50 }, 30_000)).toBe("sample");
    expect(sh.admit({ host: "slow", status: 200, ms: 2_500 }, 0)).toBe("slow");
  });

  it("ignores redirects/4xx as neither failure nor success, and bounds remembered hosts", () => {
    const sh = s();
    expect(sh.admit({ host: "a", status: 302 }, 0)).toBeNull();
    expect(sh.admit({ host: "a", status: 404 }, 0)).toBeNull();
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) sh.admit({ host: h, status: 200 }, 0);
    expect(sh.admit({ host: "h1", status: 200 }, 1)).toBe("sample"); // h1 was pruned, so it samples again
  });

  it("treats cancelled navigations and blocked requests as normal browsing", () => {
    expect(isTransientError("net::ERR_ABORTED")).toBe(true);
    expect(isTransientError("net::ERR_BLOCKED_BY_CLIENT")).toBe(true);
    expect(isTransientError("net::ERR_CONNECTION_REFUSED")).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});
