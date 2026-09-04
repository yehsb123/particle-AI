import { describe, it, expect } from "vitest";
import { relayPayload, RELAY_KINDS, DEFAULT_CONSENT, consentLayers } from "./shape";

/**
 * The content script counts that an interaction happened and never reads keys, text or the DOM.
 * The background used to forward whatever it was handed straight to the runtime, which put that
 * promise in the content script rather than here — and this file is where it is supposed to live.
 * The message is rebuilt from scratch now, so what leaves the browser is decided in one place.
 */
describe("what a relayed message may carry", () => {
  it("keeps the count and the host, and lowercases the host so one site is one site", () => {
    expect(relayPayload("interaction", { count: 5, host: "Example.COM" })).toEqual({ count: 5, host: "example.com" });
  });

  it("drops anything the kind was not allowed to bring", () => {
    // if a content script ever tried to send page content, it would end here
    expect(relayPayload("interaction", { count: 1, host: "a.com", text: "what the user typed", selection: "a secret", url: "https://a.com/x?token=1" })).toEqual({ count: 1, host: "a.com" });
    expect(relayPayload("idle", { seconds: 90, note: "extra" })).toEqual({ seconds: 90 });
    expect(relayPayload("visibility", { visible: true, awaySeconds: 12, title: "page title" })).toEqual({ visible: true, awaySeconds: 12 });
  });

  it("refuses a host that is not a hostname", () => {
    for (const host of ["a.com/path?q=secret", "https://a.com", "a com", "h".repeat(300), "", "a.com#frag"]) {
      expect(relayPayload("interaction", { count: 1, host }), host).toEqual({ count: 1 });
    }
  });

  it("takes a hostname in every shape a browser really reports", () => {
    for (const host of ["example.com", "sub.example.co.uk", "127.0.0.1", "[2001:db8::1]", "xn--80ak6aa92e.com", "localhost"]) {
      expect(relayPayload("interaction", { count: 1, host })?.host, host).toBe(host.toLowerCase());
    }
  });

  it("turns a count that is not a count into one interaction", () => {
    for (const count of ["many", null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(relayPayload("interaction", { count }), JSON.stringify(count)).toEqual({ count: 1 });
    }
  });

  it("keeps a count whole and within reason", () => {
    expect(relayPayload("interaction", { count: 3.7 })).toEqual({ count: 4 });
    expect(relayPayload("interaction", { count: 0 })).toEqual({ count: 0 });
    expect(relayPayload("interaction", { count: 1e12 })).toEqual({ count: 1_000_000 });
  });

  it("reads idle as a number of seconds, and zero when it cannot", () => {
    expect(relayPayload("idle", { seconds: 90 })).toEqual({ seconds: 90 });
    expect(relayPayload("idle", { seconds: "ninety" })).toEqual({ seconds: 0 });
    expect(relayPayload("idle", {})).toEqual({ seconds: 0 });
  });

  it("takes only a real boolean as being back", () => {
    expect(relayPayload("visibility", { visible: true, awaySeconds: 12 })).toEqual({ visible: true, awaySeconds: 12 });
    expect(relayPayload("visibility", { visible: "yes", awaySeconds: 12 })).toEqual({ visible: false, awaySeconds: 12 });
    expect(relayPayload("visibility", { visible: 1 })).toEqual({ visible: false, awaySeconds: 0 });
  });

  it("has nothing to say for a kind nobody declared", () => {
    for (const kind of ["exfiltrate", "", "screenshot", "toString", "constructor", "__proto__"]) {
      expect(relayPayload(kind, { anything: "at all" }), kind).toBeNull();
    }
  });

  it("survives a payload that is not an object", () => {
    for (const payload of [undefined, null, "60", 42, [], true]) {
      expect(relayPayload("idle", payload), JSON.stringify(payload)).toEqual({ seconds: 0 });
    }
  });

  it("declares an event type and a severity for each kind it accepts", () => {
    expect(Object.keys(RELAY_KINDS).sort()).toEqual(["idle", "interaction", "visibility"]);
    for (const [kind, meta] of Object.entries(RELAY_KINDS)) {
      expect(meta.type, kind).toMatch(/^user\./);
      expect(["debug", "info"], kind).toContain(meta.severity);
      expect(relayPayload(kind, {}), kind).not.toBeNull();
    }
  });

  it("never returns a field the runtime did not ask for, whatever arrives", () => {
    const allowed: Record<string, string[]> = { interaction: ["count", "host"], idle: ["seconds"], visibility: ["visible", "awaySeconds"] };
    const hostile = { count: 1, host: "a.com", seconds: 1, visible: true, awaySeconds: 1, __proto__: { polluted: true }, constructor: "x", body: "<html>…</html>" };
    for (const kind of Object.keys(RELAY_KINDS)) {
      const out = relayPayload(kind, hostile)!;
      for (const key of Object.keys(out)) expect(allowed[kind], `${kind}.${key}`).toContain(key);
    }
  });
});

describe("consent as it ships", () => {
  it("leaves the widest layer off until someone turns it on", () => {
    expect(DEFAULT_CONSENT.network).toBe(false);
    expect(consentLayers(DEFAULT_CONSENT)).not.toContain("network");
  });

  it("has a setting for each layer, and each is a boolean", () => {
    expect(Object.keys(DEFAULT_CONSENT).sort()).toEqual(["interactions", "network", "tabs"]);
    for (const v of Object.values(DEFAULT_CONSENT)) expect(typeof v).toBe("boolean");
  });
});
