import { describe, it, expect } from "vitest";
import { replay } from "./replay";
import { createRuntimeCore } from "./factory";
import type { MatterEvent } from "@particle/contracts";

function clock() {
  let n = 0;
  return { iso: () => `2026-08-19T00:00:${String(n % 60).padStart(2, "0")}Z`, ms: () => (++n) * 10_000 };
}

function ev(type: string, severity: MatterEvent["severity"], id: string): MatterEvent {
  return { id, sessionId: "s", timestamp: "2026-08-19T00:00:00Z", source: "development", type, severity, payload: {} };
}

const log: MatterEvent[] = [
  ev("development.build_started", "info", "e0"),
  ev("development.server_error", "critical", "e1"),
  ev("development.server_recovered", "info", "e2"),
  ev("development.server_error", "critical", "e3"),
];

describe("replay", () => {
  it("reproduces the exact final UI and world from the event log (determinism)", async () => {
    // live run
    const live = createRuntimeCore(clock());
    for (const e of log) await live.ingest(e);
    const liveUI = JSON.stringify(live.getBlueprint("s").root);
    const liveWorld = JSON.stringify(live.getWorld("s").activeProblems);

    // replay run with an identical fresh clock
    const { core } = await replay(log, clock());
    expect(JSON.stringify(core.getBlueprint("s").root)).toBe(liveUI);
    expect(JSON.stringify(core.getWorld("s").activeProblems)).toBe(liveWorld);
  });

  it("exposes per-step results for the developer inspector", async () => {
    const { steps } = await replay(log, clock());
    expect(steps).toHaveLength(4);
    expect(steps[1]!.morph.applied).toBe(true); // the first incident
    expect(steps.some((s) => s.audit.some((a) => a.kind === "ui_morph"))).toBe(true);
  });
});
