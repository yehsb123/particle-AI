import { describe, it, expect } from "vitest";
import { hostOf, networkSeverity, matterEvent, isSelfHost, DEFAULT_CONSENT } from "./shape";

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
  it("never observes the runtime/body itself; network sensing is opt-in by default", () => {
    expect(isSelfHost("localhost")).toBe(true);
    expect(isSelfHost("api.example.com")).toBe(false);
    expect(DEFAULT_CONSENT.network).toBe(false);
  });
});
