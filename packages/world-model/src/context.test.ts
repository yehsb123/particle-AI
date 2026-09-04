import { describe, it, expect } from "vitest";
import { WorldState, emptyWorldState, type MatterEvent } from "@particle/contracts";
import { reduce } from "./index";

/**
 * The rest of the belief: what the person said they are working on, what they are looking at,
 * and the window of recent events the significance reflex reads for novelty. All of it folds in
 * from events, and the window is what keeps a long session from carrying the whole log around.
 */
const T = (s = 0) => `2026-09-04T00:00:${String(s).padStart(2, "0")}Z`;
const ev = (type: string, payload: Record<string, unknown>, id = "e", over: Partial<MatterEvent> = {}): MatterEvent => ({
  id,
  sessionId: "s",
  timestamp: T(),
  source: "user",
  type,
  severity: "info",
  payload,
  ...over,
});

const fold = (events: MatterEvent[]) => events.reduce((w, e) => reduce(w, e), emptyWorldState("s", T()));

describe("what the person said they are working on", () => {
  it("records a goal with the moment it was set", () => {
    const w = fold([ev("user.changed_goal", { goal: "ship the release" }, "g1")]);
    expect(w.currentGoal).toMatchObject({ label: "ship the release", createdAt: T() });
    expect(w.currentGoal?.id).toContain("g1");
  });

  it("replaces the goal when a new one is set", () => {
    const w = fold([ev("user.changed_goal", { goal: "first" }, "g1"), ev("user.changed_goal", { goal: "second" }, "g2")]);
    expect(w.currentGoal?.label).toBe("second");
  });

  it("ignores a goal that is not one", () => {
    for (const goal of ["", 42, null, undefined, { text: "x" }]) {
      expect(fold([ev("user.changed_goal", { goal })]).currentGoal, JSON.stringify(goal) ?? "undefined").toBeUndefined();
    }
  });

  it("keeps a goal short enough to be a label", () => {
    const w = fold([ev("user.changed_goal", { goal: "g".repeat(400) })]);
    expect(w.currentGoal!.label.length).toBeLessThan(130);
    expect(WorldState.safeParse(w).success).toBe(true);
  });
});

describe("what the person is looking at", () => {
  it("records the component in focus and whether they are typing", () => {
    const w = fold([ev("user.focus_changed", { componentId: "editor", typing: true }, "f1")]);
    expect(w.attention).toEqual({ typing: true, focusedComponentId: "editor", lastInteractionAt: T() });
  });

  it("lets focus be given up without pretending someone is typing", () => {
    const focused = fold([ev("user.focus_changed", { componentId: "editor", typing: true }, "f1")]);
    const released = reduce(focused, ev("user.focus_changed", { typing: false }, "f2"));
    expect(released.attention.focusedComponentId).toBeUndefined();
    expect(released.attention.typing).toBe(false);
  });

  it("takes only a real boolean as typing, and only a string as a component", () => {
    const w = fold([ev("user.focus_changed", { componentId: 42, typing: "yes" }, "f1")]);
    expect(w.attention.typing).toBe(false);
    expect(w.attention.focusedComponentId).toBeUndefined();
    expect(WorldState.safeParse(w).success).toBe(true);
  });
});

describe("the window of recent events", () => {
  it("keeps the newest and forgets the oldest", () => {
    const w = fold(Array.from({ length: 80 }, (_, i) => ev("user.interaction", {}, `e${i}`)));
    expect(w.recentEvents.length).toBeLessThanOrEqual(50);
    expect(w.recentEvents.at(-1)?.id).toBe("e79");
    expect(w.recentEvents.some((e) => e.id === "e0")).toBe(false);
  });

  it("leaves the runtime's own bookkeeping out of it", () => {
    // a reconcile tick is not the person doing something, and counting it would make a real
    // repeated event look less repetitive than it is
    const busy = fold(Array.from({ length: 5 }, (_, i) => ev("user.interaction", {}, `e${i}`)));
    const ticked = reduce(busy, ev("runtime.reconcile", { reason: "guard_hold_expired" }, "tick", { source: "system", severity: "debug" }));
    expect(ticked.recentEvents).toHaveLength(busy.recentEvents.length);
    expect(ticked.recentEvents.some((e) => e.type === "runtime.reconcile")).toBe(false);
  });

  it("still moves the clock forward on a tick, so a hold can expire", () => {
    const before = fold([ev("user.interaction", {}, "e1")]);
    const ticked = reduce(before, ev("runtime.reconcile", {}, "tick", { source: "system", severity: "debug", timestamp: T(45) }));
    expect(ticked.updatedAt).toBe(T(45));
  });
});

describe("the machine underneath", () => {
  it("marks the host degraded on a resource warning", () => {
    const w = fold([ev("system.resource_warning", { cpu: 0.94 }, "r1", { source: "system", severity: "warning" })]);
    expect(w.environment.processes?.find((p) => p.name === "host")?.state).toBe("degraded");
    expect(w.activeProblems).toEqual([]); // a warning is not an open problem
  });

  it("keeps one entry per process rather than one per warning", () => {
    const w = fold(Array.from({ length: 5 }, (_, i) => ev("system.resource_warning", {}, `r${i}`, { source: "system", severity: "warning" })));
    expect(w.environment.processes?.filter((p) => p.name === "host")).toHaveLength(1);
  });

  it("holds at most one problem of each kind however long the session runs", () => {
    let w = emptyWorldState("s", T());
    for (let i = 0; i < 50; i += 1) {
      w = reduce(w, ev("development.server_error", {}, `p${i}`, { source: "development", severity: "critical" }));
      w = reduce(w, ev("network.request", { host: `h${i}.com`, status: 503 }, `n${i}`, { source: "sensor", severity: "warning" }));
    }
    expect(w.activeProblems).toHaveLength(2);
    expect(w.activeProblems.map((p) => p.kind).sort()).toEqual(["network_failure", "runtime_error"]);
    expect(WorldState.safeParse(w).success).toBe(true);
  });
});
