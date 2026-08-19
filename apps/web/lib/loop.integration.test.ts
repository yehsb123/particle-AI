import { describe, it, expect } from "vitest";
import type { UIBlueprint } from "@dm/contracts";
import { developmentBlueprint } from "@dm/ui-registry";
import { applyPatch, guardPatch, MorphHistory, DEFAULT_MORPH_POLICY } from "@dm/morph-engine";
import { findById } from "@dm/ui-protocol";
import { decide } from "./decide";
import { buildEvent, SIM_EVENTS } from "./sim";

const NOW = "2026-08-19T00:00:00Z";

function makeIngest(state: { bp: UIBlueprint; history: MorphHistory }) {
  return (label: string, now: number, deEscalation = false) => {
    const spec = SIM_EVENTS.find((s) => s.label === label)!;
    const ev = buildEvent(spec, "s", `e-${label}-${now}`, NOW);
    const decision = decide(ev, state.bp);
    if (!decision) return { morphed: false as const };
    const policy = deEscalation ? { ...DEFAULT_MORPH_POLICY, majorDwellMs: 0 } : DEFAULT_MORPH_POLICY;
    const guard = guardPatch({
      currentUI: state.bp, desiredPatch: decision.patch, attention: { typing: false },
      confidence: decision.confidence, severity: decision.severity, now, policy,
    });
    if (!guard.allowed) return { morphed: false as const, reasons: guard.reasonCodes };
    const { next, inverse } = applyPatch(state.bp, guard.patch, NOW);
    state.history.push(inverse);
    state.bp = next;
    return { morphed: true as const, decision };
  };
}

describe("Phase-1 runtime loop (decide → guard → apply → recover → undo)", () => {
  it("autonomously morphs on incident and recovers, all reversible", () => {
    const state = { bp: developmentBlueprint(NOW), history: new MorphHistory() };
    const ingest = makeIngest(state);

    // initial development workspace
    expect(state.bp.mode).toBe("development");
    expect(findById(state.bp.root, "editor")).toBeDefined();
    expect(findById(state.bp.root, "incident")).toBeUndefined();

    // HTTP 500 → incident morph, no user prompt
    expect(ingest("HTTP 500", 1_000).morphed).toBe(true);
    expect(findById(state.bp.root, "incident")).toBeDefined();
    expect(findById(state.bp.root, "files")?.props?.__collapsed).toBe(true);
    expect(findById(state.bp.root, "editor")).toBeDefined(); // never destroyed

    // duplicate incident → no thrash
    expect(ingest("HTTP 500", 2_000).morphed).toBe(false);

    // recovery → back to normal
    expect(ingest("Service recovered", 3_000, true).morphed).toBe(true);
    expect(findById(state.bp.root, "incident")).toBeUndefined();
    expect(findById(state.bp.root, "files")?.props?.__collapsed).toBe(false);

    // undo restores the incident
    const inv = state.history.pop()!;
    state.bp = applyPatch(state.bp, inv, NOW).next;
    expect(findById(state.bp.root, "incident")).toBeDefined();
  });

  it("ignores events that are not significant to the current context", () => {
    const state = { bp: developmentBlueprint(NOW), history: new MorphHistory() };
    const ingest = makeIngest(state);
    expect(ingest("High CPU", 1_000).morphed).toBe(false);
    expect(ingest("Critical alert", 2_000).morphed).toBe(false);
  });
});
