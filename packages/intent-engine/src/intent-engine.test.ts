import { describe, it, expect } from "vitest";
import { inferIntent, intentChanged } from "./index";
import { emptyWorldState, type WorldState } from "@particle/contracts";

const T = "2026-08-31T00:00:00Z";
const w = (patch: Partial<WorldState["behavior"]>, extra: Partial<WorldState> = {}): WorldState => {
  const base = emptyWorldState("s", T);
  return { ...base, ...extra, behavior: { ...base.behavior, ...patch } };
};

describe("inferIntent (behavior → intent, no error needed)", () => {
  it("defaults to focused with steady interaction", () => {
    expect(inferIntent(w({ interactions: 5 })).label).toBe("focused");
  });
  it("detects returning after being away", () => {
    const r = inferIntent(w({ awaySeconds: 45 }));
    expect(r.label).toBe("returning");
    expect(r.reasonCodes[0]).toMatch(/away_45s/);
  });
  it("detects idle", () => {
    expect(inferIntent(w({ idleSeconds: 90 })).label).toBe("idle");
  });
  it("detects stuck from repeated actions — even with no open problem", () => {
    const r = inferIntent(w({ repeatCount: 3, lastActionKey: "rerun-tests" }));
    expect(r.label).toBe("stuck");
    expect(r.reasonCodes).toContain("repeated_rerun-tests_x3");
  });
  it("detects debugging when a problem is open and the user is not stuck", () => {
    const world = w({}, { activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e", openedAt: T }] });
    expect(inferIntent(world).label).toBe("debugging");
  });
  it("detects exploring from breadth of entities", () => {
    expect(inferIntent(w({ recentEntities: ["a", "b", "c"] })).label).toBe("exploring");
  });
  it("prioritises returning over everything else", () => {
    expect(inferIntent(w({ awaySeconds: 60, repeatCount: 5, idleSeconds: 100 })).label).toBe("returning");
  });
  it("reports transitions", () => {
    const a = inferIntent(w({}));
    const b = inferIntent(w({ awaySeconds: 60 }));
    expect(intentChanged(undefined, a)).toBe(true);
    expect(intentChanged(a, a)).toBe(false);
    expect(intentChanged(a, b)).toBe(true);
  });
});
