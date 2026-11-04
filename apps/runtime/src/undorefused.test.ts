import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { MAX_TREE_NODES, type UIBlueprint, type UIComponent } from "@particle/contracts";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";

/**
 * An undo that was asked for and did not happen has to leave a mark.
 *
 * The core answers `null` to two different questions — there was nothing to take back, and there
 * was something and the body can no longer take it back — and the route turns both into
 * `undone: false` with a 200. Refusing beats throwing a 500 on a button somebody pressed, but the
 * step stays on the stack and the button stays lit, so the next press does nothing again. Without
 * a record there is nowhere to find out why, while every other autonomous change this runtime
 * makes is written down in the same trail.
 */
let app: FastifyInstance;
let runtime: SessionRuntime;

beforeEach(async () => {
  ({ app, runtime } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const countNodes = (node: UIComponent): number => 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);

/** The session's own body, grown to exactly what a body may be, so one more node cannot go in. */
function fillTheBody(session: string): void {
  const sessions = (runtime.core as unknown as { sessions: Map<string, { blueprint: UIBlueprint }> }).sessions;
  const s = sessions.get(session)!;
  const root: UIComponent = structuredClone(s.blueprint.root);
  root.children ??= [];
  for (let i = countNodes(root); i < MAX_TREE_NODES; i++) root.children.push({ id: `filler-${i}`, type: "Text", props: { text: "x" } });
  s.blueprint = { ...s.blueprint, root };
}

const kinds = (session: string) => runtime.audit.list(session).map((r) => r.kind);

describe("an undo the body can no longer take", () => {
  it("writes the refusal to the trail, instead of answering the same as having nothing to undo", async () => {
    await app.inject({ method: "POST", url: "/api/sim/ur1/http-500" });
    await app.inject({ method: "POST", url: "/api/sim/ur1/recovered" }); // removes the incident card
    fillTheBody("ur1");

    const res = await app.inject({ method: "POST", url: "/api/morph/ur1/undo", payload: {} });
    expect(res.json().undone).toBe(false);
    expect(kinds("ur1")).toContain("morph_undo_refused");
    expect(kinds("ur1")).not.toContain("morph_undone");
  });

  it("says nothing when there was simply nothing to take back", async () => {
    await app.inject({ method: "GET", url: "/api/sessions/ur2/state" });
    const res = await app.inject({ method: "POST", url: "/api/morph/ur2/undo", payload: {} });
    expect(res.json().undone).toBe(false);
    expect(kinds("ur2")).not.toContain("morph_undo_refused");
  });

  it("still records the undo itself when the body has room", async () => {
    await app.inject({ method: "POST", url: "/api/sim/ur3/http-500" });
    await app.inject({ method: "POST", url: "/api/sim/ur3/recovered" });
    const res = await app.inject({ method: "POST", url: "/api/morph/ur3/undo", payload: {} });
    expect(res.json().undone).toBe(true);
    expect(kinds("ur3")).toContain("morph_undone");
    expect(kinds("ur3")).not.toContain("morph_undo_refused");
  });
});
