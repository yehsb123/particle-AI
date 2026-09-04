import { describe, it, expect } from "vitest";
import { WorldState, emptyWorldState, type MatterEvent } from "@particle/contracts";
import { reduce } from "./index";

/**
 * The world model is what the runtime believes is going on, and every decision is made against
 * it. Its inputs are events, and an event's `type` is any string a client can post, so the two
 * properties that matter are: whatever arrives, the result is still a world state the schema
 * accepts, and a problem that opened can always be closed again.
 */
const T = (s = 0) => `2026-09-04T00:00:${String(s).padStart(2, "0")}Z`;

const ev = (type: string, over: Partial<MatterEvent> = {}): MatterEvent => ({
  id: `e-${type}-${over.id ?? ""}`,
  sessionId: "s",
  timestamp: T(),
  source: "development",
  type,
  severity: "critical",
  payload: {},
  ...over,
});

const fold = (events: MatterEvent[]) => events.reduce((w, e) => reduce(w, e), emptyWorldState("s", T()));
const kinds = (events: MatterEvent[]) => fold(events).activeProblems.map((p) => p.kind);

describe("a problem opens, and can be closed again", () => {
  it("opens one for each kind of trouble the runtime knows", () => {
    expect(kinds([ev("development.server_error")])).toEqual(["runtime_error"]);
    expect(kinds([ev("development.build_failed")])).toEqual(["build_failure"]);
    expect(kinds([ev("development.test_failed")])).toEqual(["test_failure"]);
    expect(kinds([ev("security.vulnerability_detected")])).toEqual(["security_alert"]);
  });

  it("describes it in a way a person can read", () => {
    const problem = fold([ev("development.server_error", { id: "e1" })]).activeProblems[0]!;
    expect(problem.summary.length).toBeGreaterThan(0);
    expect(problem.severity).toBe("critical");
    expect(problem.openedByEventId).toBe("e1");
    expect(problem.openedAt).toBe(T());
    expect(problem.id).toContain("prob-");
  });

  it("does not open a second one for trouble that is already open", () => {
    expect(kinds([ev("development.server_error", { id: "a" }), ev("development.server_error", { id: "b" })])).toEqual(["runtime_error"]);
  });

  it("closes the matching one and leaves the others alone", () => {
    const both = [ev("development.server_error"), ev("development.build_failed")];
    expect(kinds(both)).toEqual(["runtime_error", "build_failure"]);
    expect(kinds([...both, ev("development.server_recovered", { severity: "info" })])).toEqual(["build_failure"]);
    expect(kinds([...both, ev("development.build_succeeded", { severity: "info" })])).toEqual(["runtime_error"]);
  });

  it("takes a recovery for something that was never broken as nothing to do", () => {
    expect(kinds([ev("development.server_recovered", { severity: "info" })])).toEqual([]);
  });

  it("can open, close and open again", () => {
    const again = [
      ev("development.server_error", { id: "a" }),
      ev("development.server_recovered", { id: "b", severity: "info" }),
      ev("development.server_error", { id: "c" }),
    ];
    expect(kinds(again)).toEqual(["runtime_error"]);
    expect(fold(again).activeProblems[0]?.openedByEventId).toBe("c");
  });

  it("marks the process failed while a runtime error is open, and healthy again after", () => {
    const failing = fold([ev("development.server_error")]);
    expect(failing.environment.processes?.find((p) => p.name === "API")?.state).toBe("failed");
    const recovered = reduce(failing, ev("development.server_recovered", { severity: "info" }));
    expect(recovered.environment.processes?.find((p) => p.name === "API")?.state).toBe("healthy");
  });
});

describe("an event type is a string a client chose", () => {
  const HOSTILE = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "propertyIsEnumerable"];

  it("opens nothing for a type nobody defined", () => {
    for (const type of [...HOSTILE, "unknown.thing", "a", "development.something_else"]) {
      expect(kinds([ev(type)]), type).toEqual([]);
    }
  });

  it("still produces a world state the schema accepts", () => {
    // a type of "toString" used to open a problem with no kind, no summary and no severity —
    // a world state that fails its own validation, and a problem nothing could ever close
    for (const type of [...HOSTILE, "development.server_error", "unknown.thing"]) {
      const parsed = WorldState.safeParse(fold([ev(type)]));
      expect(parsed.success, `${type}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`).toBe(true);
    }
  });

  it("does not let such a type disturb a problem that is genuinely open", () => {
    const open = fold([ev("development.server_error")]);
    for (const type of HOSTILE) {
      const after = reduce(open, ev(type, { severity: "info" }));
      expect(after.activeProblems.map((p) => p.kind), type).toEqual(["runtime_error"]);
    }
  });

  it("keeps every problem closable, whatever arrived in between", () => {
    const messy = [ev("development.server_error"), ...HOSTILE.map((t) => ev(t, { severity: "info" })), ev("development.server_recovered", { severity: "info" })];
    expect(kinds(messy)).toEqual([]);
  });
});

describe("the reducer is a reducer", () => {
  it("never changes the state it was given", () => {
    const before = emptyWorldState("s", T());
    const snapshot = JSON.stringify(before);
    reduce(before, ev("development.server_error"));
    reduce(before, ev("development.build_failed"));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("gives the same answer for the same inputs, in the same order", () => {
    const events = [ev("development.server_error", { id: "a" }), ev("development.test_failed", { id: "b" }), ev("development.server_recovered", { id: "c", severity: "info" })];
    expect(JSON.stringify(fold(events))).toBe(JSON.stringify(fold(events)));
  });

  it("moves the clock forward with the event it just folded in", () => {
    const after = reduce(emptyWorldState("s", T(0)), ev("development.server_error", { timestamp: T(30) }));
    expect(after.updatedAt).toBe(T(30));
  });

  it("keeps the session it belongs to", () => {
    expect(reduce(emptyWorldState("mine", T()), ev("development.server_error")).sessionId).toBe("mine");
  });
});
