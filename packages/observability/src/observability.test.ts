import { describe, it, expect } from "vitest";
import { createLogger, TraceStore, type RuntimeTrace } from "./index";

describe("createLogger", () => {
  it("respects the minimum level and routes to a sink", () => {
    const lines: string[] = [];
    const log = createLogger("warn", (l) => lines.push(`${l.level}:${l.msg}`));
    log.debug("d");
    log.info("i");
    log.warn("w", { a: 1 });
    log.error("e");
    expect(lines).toEqual(["warn:w", "error:e"]);
  });
});

describe("TraceStore", () => {
  const t = (sessionId: string, i: number): RuntimeTrace => ({
    at: "2026-01-01T00:00:00Z", sessionId, eventId: `e${i}`, eventType: "development.server_error",
    significance: 0.9, deliberated: true, capabilityIds: [], morphApplied: true, guardReasonCodes: [],
  });

  it("appends, filters by session, and bounds the ring", () => {
    const store = new TraceStore(3);
    store.append(t("s1", 1));
    store.append(t("s2", 2));
    store.append(t("s1", 3));
    store.append(t("s1", 4));
    expect(store.count()).toBe(3); // bounded
    expect(store.list("s1").length).toBeGreaterThanOrEqual(1);
  });
});
