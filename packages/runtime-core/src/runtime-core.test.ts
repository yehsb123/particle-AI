import { describe, it, expect } from "vitest";
import { createRuntimeCore } from "./factory";
import { findById } from "@particle/ui-protocol";
import type { MatterEvent } from "@particle/contracts";

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

  it("adapts the incident layout to the problem kind", async () => {
    const build = createRuntimeCore(makeClock());
    await build.ingest(ev("development.build_failed", "warning", "b1"));
    expect(findById(build.getBlueprint("s").root, "incident")?.props?.title).toBe("Build failure");

    const test = createRuntimeCore(makeClock());
    await test.ingest(ev("development.test_failed", "warning", "t1"));
    expect(findById(test.getBlueprint("s").root, "incident")?.props?.title).toBe("Test failure");

    const runtime = createRuntimeCore(makeClock());
    await runtime.ingest(ev("development.server_error", "critical", "r1"));
    expect(findById(runtime.getBlueprint("s").root, "incident")?.props?.title).toBe("Runtime incident");
  });

  it("protects the editor: an incident never removes unsaved work", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("development.server_error", "critical", "e1"));
    // editor still present with unsaved content
    const editor = findById(core.getBlueprint("s").root, "editor");
    expect(editor).toBeDefined();
    expect(editor?.volatile).toBe(true);
  });

  it("gates the external-effect remediation behind human approval, then executes on approve", async () => {
    const core = createRuntimeCore(makeClock());
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));

    // read-only diagnostics ran automatically; the risky revert did NOT
    expect(inc.capabilityRuns.map((r) => r.capabilityId)).not.toContain("development.revert_diff");
    expect(inc.pendingApprovals.map((a) => a.capabilityId)).toContain("development.revert_diff");
    const approvalId = inc.pendingApprovals.find((a) => a.capabilityId === "development.revert_diff")!.id;

    // approving executes the capability
    const outcome = await core.approve(approvalId);
    expect(outcome?.result.ok).toBe(true);
    expect((outcome?.result.output as { reverted: boolean }).reverted).toBe(true);
    expect(core.approvals.get(approvalId)?.status).toBe("approved");
  });

  it("auto-runs the remediation at autonomy level 4 (no approval needed)", async () => {
    const core = createRuntimeCore(makeClock());
    core.setAutonomyLevel(4);
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));
    expect(inc.capabilityRuns.map((r) => r.capabilityId)).toContain("development.revert_diff");
    expect(inc.pendingApprovals).toHaveLength(0);
  });

  it("gates even read capabilities below adaptive level (L1)", async () => {
    const core = createRuntimeCore(makeClock());
    core.setAutonomyLevel(1);
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));
    // at L1 the AI is passive: read caps are denied (not auto-run, not approvable)
    expect(inc.capabilityRuns).toHaveLength(0);
    expect(inc.permission?.denied.length).toBeGreaterThan(0);
  });

  it("Concept v2: reshapes the body from BEHAVIOR alone — returning after being away (no error)", async () => {
    const core = createRuntimeCore(makeClock());
    const res = await core.ingest({
      id: "v1", sessionId: "s", timestamp: "2026-08-31T00:00:00Z",
      source: "user", type: "user.visibility", severity: "info", payload: { visible: true, awaySeconds: 120 },
    });
    expect(res.worldState.inferredIntent?.label).toBe("returning");
    expect(res.deliberated).toBe(true);
    expect(res.decision?.uiPlan?.intent).toBe("augment");
    expect(res.morph.applied).toBe(true);
    const card = findById(core.getBlueprint("s").root, "context");
    expect(card?.props?.title).toBe("Welcome back");
    // the summary is LIVE from workspace.get_state (binding), not the placeholder
    expect(String(findById(core.getBlueprint("s").root, "context-text")?.props?.text)).toMatch(/Nothing broke/);
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined(); // no incident at all
  });

  it("Concept v2: repeated actions read as 'stuck' and surface related context (no error)", async () => {
    const core = createRuntimeCore(makeClock());
    const act = (n: number) => ({
      id: `a${n}`, sessionId: "s", timestamp: "2026-08-31T00:00:00Z",
      source: "user" as const, type: "user.action", severity: "info" as const, payload: { key: "rerun-tests" },
    });
    await core.ingest(act(1));
    await core.ingest(act(2));
    const third = await core.ingest(act(3));
    expect(third.worldState.inferredIntent?.label).toBe("stuck");
    expect(third.morph.applied).toBe(true);
    expect(findById(core.getBlueprint("s").root, "context")?.props?.title).toBe("You seem stuck on this");
  });

  it("resolves data bindings: capability outputs feed the morphed body (spec 5)", async () => {
    const core = createRuntimeCore(makeClock());
    // runtime incident: LogViewer lines come from development.read_logs, not the placeholder
    await core.ingest(ev("development.server_error", "critical", "e1"));
    const logs = findById(core.getBlueprint("s").root, "incident-logs");
    expect(logs?.props?.lines).not.toEqual(["collecting…"]);
    expect(JSON.stringify(logs?.props?.lines)).toContain("500 Internal Server Error");

    // security incident: Table rows come from security.scan_dependencies
    const sec = createRuntimeCore(makeClock());
    await sec.ingest({
      id: "v1", sessionId: "s", timestamp: "2026-08-19T00:00:00Z",
      source: "external", type: "security.vulnerability_detected", severity: "critical", payload: {},
    });
    const vuln = findById(sec.getBlueprint("s").root, "incident-vuln");
    expect(vuln?.props?.rows).toEqual([["lodash@4.17.20", "critical", "CVE-2026-1234"]]);
  });

  it("handles the security scenario: scan runs, update is gated, patched restores", async () => {
    const core = createRuntimeCore(makeClock());
    const vuln = await core.ingest({
      id: "v1", sessionId: "s", timestamp: "2026-08-19T00:00:00Z",
      source: "external", type: "security.vulnerability_detected", severity: "critical", payload: {},
    });
    expect(vuln.morph.applied).toBe(true);
    expect(findById(core.getBlueprint("s").root, "incident")?.props?.title).toBe("Security alert");
    // read-only scan ran automatically; the external-effect update did NOT
    expect(vuln.capabilityRuns.map((r) => r.capabilityId)).toContain("security.scan_dependencies");
    expect(vuln.pendingApprovals.map((a) => a.capabilityId)).toContain("security.update_dependency");
    // approving executes the update
    const out = await core.approve(vuln.pendingApprovals[0]!.id);
    expect((out?.result.output as { updated: string }).updated).toBe("lodash@4.17.21");
    // patched → back to development
    const patched = await core.ingest({
      id: "v2", sessionId: "s", timestamp: "2026-08-19T00:00:01Z",
      source: "external", type: "security.vulnerability_patched", severity: "info", payload: {},
    });
    expect(patched.morph.applied).toBe(true);
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();
  });

  it("marks a repeated incident as recurring (experience shapes the body)", async () => {
    const core = createRuntimeCore(makeClock());
    // 1st incident: no recurrence badge
    await core.ingest(ev("development.server_error", "critical", "e1"));
    expect(findById(core.getBlueprint("s").root, "incident-recurrence")).toBeUndefined();
    await core.ingest(ev("development.server_recovered", "info", "e2"));
    // 2nd incident: episodic memory has seen this — badge appears with ×2
    await core.ingest(ev("development.server_error", "critical", "e3"));
    const badge = findById(core.getBlueprint("s").root, "incident-recurrence-count");
    expect(badge?.props?.text).toBe("×2");
    // fresh session is unaffected (memory is per-session)
    await core.ingest({ ...ev("development.server_error", "critical", "e4"), sessionId: "other" });
    expect(findById(core.getBlueprint("other").root, "incident-recurrence")).toBeUndefined();
  });

  it("keeps memory and approvals isolated per session", async () => {
    const core = createRuntimeCore(makeClock());
    const a = await core.ingest({ ...ev("development.server_error", "critical", "ea"), sessionId: "A" });
    const b = await core.ingest({ ...ev("development.server_error", "critical", "eb"), sessionId: "B" });
    // both sessions get their own approval (ids differ by session), neither is dropped
    expect(a.pendingApprovals.length).toBe(1);
    expect(b.pendingApprovals.length).toBe(1);
    expect(a.pendingApprovals[0]!.id).not.toBe(b.pendingApprovals[0]!.id);
    // per-session memory: each has exactly one episode, not two
    expect(core.memoryFor("A").episodic.count()).toBe(1);
    expect(core.memoryFor("B").episodic.count()).toBe(1);
  });

  it("re-offers a capability after it was rejected", async () => {
    const core = createRuntimeCore(makeClock());
    const first = await core.ingest(ev("development.server_error", "critical", "e1"));
    const id = first.pendingApprovals[0]!.id;
    core.reject(id);
    expect(core.approvals.get(id)).toBeUndefined(); // removed, so it can recur
  });

  it("hydrates a session's UI + world from a snapshot (resume)", async () => {
    const source = createRuntimeCore(makeClock());
    await source.ingest(ev("development.server_error", "critical", "e1"));
    const ui = source.getBlueprint("s");
    const world = source.getWorld("s");
    expect(findById(ui.root, "incident")).toBeDefined();

    // a fresh runtime resumes the session from the persisted snapshot
    const resumed = createRuntimeCore(makeClock());
    expect(findById(resumed.getBlueprint("s").root, "incident")).toBeUndefined(); // seed
    resumed.hydrate("s", { blueprint: ui, world });
    expect(findById(resumed.getBlueprint("s").root, "incident")).toBeDefined();
    expect(resumed.getWorld("s").activeProblems.length).toBe(1);
  });

  it("does not execute a rejected capability", async () => {
    const core = createRuntimeCore(makeClock());
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));
    const approvalId = inc.pendingApprovals[0]!.id;
    core.reject(approvalId);
    expect(core.approvals.get(approvalId)).toBeUndefined(); // removed so it can be re-offered
    expect(await core.approve(approvalId)).toBeNull(); // cannot execute a rejected capability
  });
  it("Concept v2 (L2): the SHAPE of failing traffic opens a connection incident; recovery closes it", async () => {
    const core = createRuntimeCore(makeClock());
    const req = (id: string, status: number, sev: "warning" | "info") => ({
      id, sessionId: "s", timestamp: "2026-08-31T00:00:00Z", source: "sensor" as const,
      type: "network.request", severity: sev, payload: { host: "api.example.com", status, ms: 900 },
    });
    const fail = await core.ingest(req("n1", 503, "warning"));
    expect(fail.worldState.activeProblems.map((p) => p.kind)).toEqual(["network_failure"]);
    expect(fail.morph.applied).toBe(true);
    const panel = findById(core.getBlueprint("s").root, "incident");
    expect(panel?.props?.title).toBe("Connection trouble");
    // rows are bound from network.inspect_shape - real hosts, no placeholder
    expect(findById(core.getBlueprint("s").root, "incident-hosts")?.props?.rows).toEqual([["api.example.com", "failing"]]);
    // a second failure to the same host does not re-deliberate (anti-thrash)
    const again = await core.ingest(req("n2", 503, "warning"));
    expect(again.morph.applied).toBe(false);
    // recovery of the only failing host closes the problem and the body returns to work
    const ok = await core.ingest(req("n3", 200, "info"));
    expect(ok.worldState.activeProblems).toEqual([]);
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();
  });
  it("Concept v2 (L4): repeated saves of the same file read as 'stuck' (desktop agent path)", async () => {
    const core = createRuntimeCore(makeClock());
    const save = (n: number) => ({
      id: `f${n}`, sessionId: "desktop", timestamp: "2026-08-31T00:00:00Z",
      source: "user" as const, type: "user.opened_file", severity: "debug" as const, payload: { path: "src/db.ts" },
    });
    await core.ingest(save(1));
    await core.ingest(save(2));
    const third = await core.ingest(save(3));
    expect(third.worldState.inferredIntent?.label).toBe("stuck");
    expect(third.morph.applied).toBe(true);
    expect(findById(core.getBlueprint("desktop").root, "context")?.props?.title).toBe("You seem stuck on this");
  });
  it("Concept v2 (P4): learns from dismissals — after two undos of the same augmentation it stops offering it", async () => {
    const core = createRuntimeCore(makeClock());
    const act = (n: number) => ({
      id: `a${n}`, sessionId: "s", timestamp: "2026-08-31T00:00:00Z",
      source: "user" as const, type: "user.action", severity: "info" as const, payload: { key: "rerun-tests" },
    });
    await core.ingest(act(1));
    await core.ingest(act(2));
    expect((await core.ingest(act(3))).morph.applied).toBe(true); // stuck → context card
    core.undo("s"); // dismissal 1
    expect(findById(core.getBlueprint("s").root, "context")).toBeUndefined();
    expect((await core.ingest(act(4))).morph.applied).toBe(true); // offered again
    core.undo("s"); // dismissal 2
    const fifth = await core.ingest(act(5));
    expect(fifth.morph.applied).toBe(false);
    expect(fifth.morph.guardReasonCodes).toContain("learned_preference");
    expect(fifth.learned).toEqual({ suppressed: "augment:stuck", dismissals: 2 });
    expect(fifth.audit.some((a) => a.kind === "morph_suppressed")).toBe(true);
    expect(findById(core.getBlueprint("s").root, "context")).toBeUndefined();
    // incidents are never suppressed by this — a real problem still surfaces
    const inc = await core.ingest(ev("development.server_error", "critical", "e9"));
    expect(inc.morph.applied).toBe(true);
    expect(core.memoryFor("s").preferences.weightOf("dismissed:augment:stuck")).toBe(2);
  });
});

describe("RuntimeCore — switching (Concept v2)", () => {
  it("alternating between two files reads as 'switching' and pins them beside the work (no error)", async () => {
    const core = createRuntimeCore(makeClock());
    const open = (n: number, path: string) => ({
      id: `o${n}`, sessionId: "s", timestamp: "2026-08-31T00:00:00Z",
      source: "user" as const, type: "user.opened_file", severity: "debug" as const, payload: { path },
    });
    let last;
    for (let i = 0; i < 6; i++) last = await core.ingest(open(i, i % 2 ? "src/db.ts" : "src/routes.ts"));
    expect(last!.worldState.inferredIntent?.label).toBe("switching");
    expect(last!.significance.reasonCodes).toContain("intent_transition");
    expect(last!.morph.applied).toBe(true);
    const card = findById(core.getBlueprint("s").root, "context");
    expect(card?.props?.title).toBe("Juggling several things");
    const text = String(findById(core.getBlueprint("s").root, "context-text")?.props?.text);
    expect(text).toContain("src/db.ts");
    expect(text).toContain("src/routes.ts");
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();
  });
});

describe("RuntimeCore — resolution beats augmentation", () => {
  it("recovery wins over switching: a closer event restores the body even while the person is juggling", async () => {
    const core = createRuntimeCore(makeClock());
    const act = (n: number, key: string) => ({
      id: `k${n}`, sessionId: "s", timestamp: "2026-08-31T00:00:00Z",
      source: "user" as const, type: "user.action", severity: "info" as const, payload: { key },
    });
    await core.ingest(ev("development.server_error", "critical", "e1"));
    expect(findById(core.getBlueprint("s").root, "incident")).toBeDefined();
    for (let i = 0; i < 6; i++) await core.ingest(act(i, i % 2 ? "recovered" : "http-500"));
    // the person is now "switching" (A B A B A B) — the recovery must still de-escalate
    const rec = await core.ingest(ev("development.server_recovered", "info", "e2"));
    expect(rec.worldState.inferredIntent?.label).toBe("switching");
    expect(rec.decision?.uiPlan?.intent).toBe("restore_normal");
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();
  });
});
