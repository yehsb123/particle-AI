import { describe, it, expect } from "vitest";
import { createRuntimeCore } from "./factory";
import { findById } from "@particle/ui-protocol";
import { MORPH_HOLD_REASONS, type MatterEvent, type UIComponent } from "@particle/contracts";

/**
 * A patch can pass the morph guard and still be impossible against the tree it is aimed at —
 * most plausibly after a resume, since `hydrate` takes a blueprint from a snapshot that another
 * build wrote. The runtime has to refuse it the way the guard refuses one, and keep answering.
 */
function makeClock() {
  let n = 0;
  return { iso: () => `2026-09-03T00:00:${String(n % 60).padStart(2, "0")}Z`, ms: () => (++n) * 10_000 };
}

const ev = (type: string, severity: MatterEvent["severity"], id: string): MatterEvent => ({
  id,
  sessionId: "s",
  timestamp: "2026-09-03T00:00:00Z",
  source: "development",
  type,
  severity,
  payload: {},
});

/** A blueprint carrying an id the incident layout also uses, with no `incident` node of its own. */
function staleBlueprint(root: UIComponent): UIComponent {
  return { ...root, children: [...(root.children ?? []), { id: "incident-grid", type: "Stack" }] };
}

describe("a morph the tree cannot hold", () => {
  it("is refused, recorded, and leaves the session exactly as it was", async () => {
    const core = createRuntimeCore(makeClock());
    const stale = staleBlueprint(core.getBlueprint("s").root);
    core.hydrate("s", { blueprint: { ...core.getBlueprint("s"), root: stale } });

    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));

    // it still deliberated and still decided — only the body could not take the change
    expect(inc.deliberated).toBe(true);
    expect(inc.decision?.uiPlan?.intent).toBe("surface_incident");
    expect(inc.morph.applied).toBe(false);
    expect(inc.morph.guardReasonCodes).toContain("structurally_impossible");
    expect(inc.morph.dropped.join(" ")).toContain("incident-grid");
    expect(inc.audit.some((a) => a.kind === "morph_blocked")).toBe(true);

    // the tree is untouched: no half-applied incident, and the stale node still there
    expect(findById(core.getBlueprint("s").root, "incident")).toBeUndefined();
    expect(findById(core.getBlueprint("s").root, "incident-grid")).toBeDefined();
    expect(core.getBlueprint("s").root).toEqual(stale);
  });

  it("gives a reason the body has words for", async () => {
    // the body turns these codes into a sentence in the reader's language; a code that is not in
    // the canonical list reaches the screen as a bare identifier
    const core = createRuntimeCore(makeClock());
    core.hydrate("s", { blueprint: { ...core.getBlueprint("s"), root: staleBlueprint(core.getBlueprint("s").root) } });
    const inc = await core.ingest(ev("development.server_error", "critical", "e1"));
    for (const code of inc.morph.guardReasonCodes) {
      expect(MORPH_HOLD_REASONS as readonly string[], code).toContain(code);
    }
  });

  it("keeps taking events afterwards", async () => {
    const core = createRuntimeCore(makeClock());
    core.hydrate("s", { blueprint: { ...core.getBlueprint("s"), root: staleBlueprint(core.getBlueprint("s").root) } });
    await core.ingest(ev("development.server_error", "critical", "e1"));

    const after = await core.ingest(ev("development.server_recovered", "info", "e2"));
    expect(after.deliberated).toBe(true);
    expect(after.blueprint).toBeDefined();
    expect(core.getWorld("s").activeProblems.length).toBe(0);
  });

  it("has nothing to undo, since nothing was applied", async () => {
    const core = createRuntimeCore(makeClock());
    core.hydrate("s", { blueprint: { ...core.getBlueprint("s"), root: staleBlueprint(core.getBlueprint("s").root) } });
    const before = core.getBlueprint("s").root;
    await core.ingest(ev("development.server_error", "critical", "e1"));
    core.undo("s");
    expect(core.getBlueprint("s").root).toEqual(before);
  });

  it("morphs normally once the colliding node is gone", async () => {
    const core = createRuntimeCore(makeClock());
    core.hydrate("s", { blueprint: { ...core.getBlueprint("s"), root: staleBlueprint(core.getBlueprint("s").root) } });
    expect((await core.ingest(ev("development.server_error", "critical", "e1"))).morph.applied).toBe(false);

    // a fresh session with a clean tree takes the same event without complaint
    const clean = createRuntimeCore(makeClock());
    const ok = await clean.ingest(ev("development.server_error", "critical", "e1"));
    expect(ok.morph.applied).toBe(true);
    expect(findById(clean.getBlueprint("s").root, "incident")).toBeDefined();
  });
});
