import { describe, it, expect } from "vitest";
import { createRuntimeCore } from "./factory";
import { findById } from "@dm/ui-protocol";
import type { MatterEvent } from "@dm/contracts";

function makeClock() {
  let n = 0;
  return { iso: () => `2026-08-19T00:00:${String(n % 60).padStart(2, "0")}Z`, ms: () => (++n) * 10_000 };
}

function ev(type: string, severity: MatterEvent["severity"], id: string): MatterEvent {
  return { id, sessionId: "s", timestamp: "2026-08-19T00:00:00Z", source: "development", type, severity, payload: {} };
}

describe("RuntimeCore — full loop", () => {
  it("runs perception → decision → capability → morph on an incident, then recovers and undoes", async () => {
    const core = createRuntimeCore(makeClock());

    // insignificant event: no deliberation, no morph
    const noop = await core.ingest(ev("development.build_started", "info", "e0"));
    expect(noop.deliberated).toBe(false);
    expect(noop.morph.applied).toBe(false);

    // HTTP 500 → full incident loop
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));
    expect(inc.deliberated).toBe(true);
    expect(inc.decision?.uiPlan?.intent).toBe("surface_incident");
    expect(inc.morph.applied).toBe(true);
    expect(inc.capabilityRuns.length).toBe(3); // read_logs, read_build_state, data.inspect
    expect(inc.capabilityRuns.every((r) => r.result.ok)).toBe(true);
    expect(findById(core.getBlueprint("s").root, "incident")).toBeDefined();
    expect(inc.audit.some((a) => a.kind === "ui_morph")).toBe(true);

    // recovery → de-escalate back to development
    const rec = await core.ingest(ev("development.server_recovered", "info", "e2"));
    expect(rec.deliberated).toBe(true);
    expect(rec.decision?.uiPlan?.intent).toBe("restore_normal");
    expect(rec.morph.applied).toBe(true);
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();

    // undo restores the incident
    core.undo("s");
    expect(findById(core.getBlueprint("s").root, "incident")).toBeDefined();
  });

  it("protects the editor: an incident never removes unsaved work", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("development.server_error", "critical", "e1"));
    // editor still present with unsaved content
    const editor = findById(core.getBlueprint("s").root, "editor");
    expect(editor).toBeDefined();
    expect(editor?.volatile).toBe(true);
  });
});
