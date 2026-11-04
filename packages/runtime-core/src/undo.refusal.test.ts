import { describe, it, expect } from "vitest";
import { MAX_TREE_NODES, type MatterEvent, type UIBlueprint, type UIComponent } from "@particle/contracts";
import { createRuntimeCore } from "./factory";
import type { RuntimeCore } from "./index";

/**
 * An undo that cannot be applied has to answer, not throw.
 *
 * Three of the four places this runtime applies a patch already catch: the ingest loop refuses a
 * patch the tree cannot take, the redo stack drains entries that no longer fit, and a stale
 * dismiss returns null. The plain undo did not, and it is the one with an HTTP route in front of
 * it — a thrown MorphApplyError there is a 500 on a button a person pressed.
 *
 * The case the morph engine's own comment said could not happen: the inverse of a removal is an
 * `add`, and a tree that has grown since cannot necessarily take it back. The runtime applies
 * inverses in the order it recorded them, so it does not reach this on its own today — but
 * "today's call order never reaches it" is not what the other three call sites rely on, and it is
 * not something a route should be staking a 500 on.
 */
const T = "2026-09-04T00:00:00Z";
const clock = () => ({ iso: () => T, ms: () => 0 });

const ev = (type: string, severity: MatterEvent["severity"], id: string): MatterEvent => ({
  id,
  sessionId: "s",
  timestamp: T,
  source: "development",
  type,
  severity,
  payload: {},
});

/** The session the core is holding, so a test can put its stack and its tree out of step. */
const sessionOf = (core: RuntimeCore, id: string) =>
  (core as unknown as { sessions: Map<string, { blueprint: UIBlueprint }> }).sessions.get(id)!;

const countNodes = (node: UIComponent): number =>
  1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);

/** The same body, grown to exactly what a body may be. */
const grownToTheLimit = (blueprint: UIBlueprint): UIBlueprint => {
  const root: UIComponent = structuredClone(blueprint.root);
  root.children ??= [];
  for (let i = countNodes(root); i < MAX_TREE_NODES; i++) {
    root.children.push({ id: `filler-${i}`, type: "Text", props: { text: "x" } });
  }
  return { ...blueprint, root };
};

describe("an undo whose inverse the body can no longer take", () => {
  it("answers with nothing instead of throwing out to the route", async () => {
    const core = createRuntimeCore(clock());
    await core.ingest(ev("development.server_error", "critical", "e1"));
    await core.ingest(ev("development.server_recovered", "info", "e2")); // removes the incident card
    expect(core.canUndo("s")).toBe(true);

    const s = sessionOf(core, "s");
    s.blueprint = grownToTheLimit(s.blueprint);
    expect(countNodes(s.blueprint.root)).toBe(MAX_TREE_NODES);

    expect(() => core.undo("s")).not.toThrow();
    expect(core.undo("s")).toBeNull();
  });

  it("keeps the step it could not take, so the body and the stack stay in step", async () => {
    const core = createRuntimeCore(clock());
    await core.ingest(ev("development.server_error", "critical", "e1"));
    await core.ingest(ev("development.server_recovered", "info", "e2"));
    const depth = core.historyDepth("s");

    const s = sessionOf(core, "s");
    s.blueprint = grownToTheLimit(s.blueprint);
    core.undo("s");

    // nothing popped, nothing learned: the refusal is not a step the person took
    expect(core.historyDepth("s")).toBe(depth);
    expect(core.canUndo("s")).toBe(true);
    expect(core.memoryFor("s").preferences.weightOf("dismissed:restore_normal:")).toBe(0);
  });

  it("still undoes normally when the body has room", async () => {
    const core = createRuntimeCore(clock());
    await core.ingest(ev("development.server_error", "critical", "e1"));
    await core.ingest(ev("development.server_recovered", "info", "e2"));
    expect(core.undo("s")).not.toBeNull();
    expect(core.canUndo("s")).toBe(true);
  });
});
