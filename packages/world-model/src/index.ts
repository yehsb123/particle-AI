import type { MatterEvent, Problem, ProcessState, WorldState } from "@particle/contracts";
import { RECENT_EVENTS_LIMIT } from "@particle/contracts";

const PROBLEM_OPENERS: Record<string, { kind: string; summary: string; severity: "warning" | "critical" }> = {
  "development.server_error": { kind: "runtime_error", summary: "Service returned a runtime error", severity: "critical" },
  "development.build_failed": { kind: "build_failure", summary: "Build failed", severity: "warning" },
  "development.test_failed": { kind: "test_failure", summary: "Tests failed", severity: "warning" },
};

/** Which problem kind an event resolves. */
const PROBLEM_CLOSERS: Record<string, string> = {
  "development.server_recovered": "runtime_error",
  "development.build_succeeded": "build_failure",
  "development.test_passed": "test_failure",
};

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function setProcess(
  processes: ProcessState[] | undefined,
  name: string,
  state: ProcessState["state"],
): ProcessState[] {
  const list = (processes ?? []).filter((p) => p.name !== name);
  list.push({ name, state });
  return list;
}

/**
 * Pure world-state reducer: fold an event into the previous belief state. No side effects,
 * no clock reads (time comes from the event). This is the most heavily tested pure function
 * in the runtime.
 */
export function reduce(prev: WorldState, event: MatterEvent): WorldState {
  const recentEvents = [...prev.recentEvents, event].slice(-RECENT_EVENTS_LIMIT);
  const next: WorldState = {
    ...prev,
    updatedAt: event.timestamp,
    recentEvents,
    activeContext: { ...prev.activeContext },
    environment: { ...prev.environment },
    activeProblems: [...prev.activeProblems],
    attention: { ...prev.attention },
  };

  // Context from source
  if (event.source === "development") {
    next.activeContext.domain = "software";
    next.activeContext.activity = "development";
  }

  // Open a problem
  const opener = PROBLEM_OPENERS[event.type];
  if (opener) {
    const exists = next.activeProblems.some((p) => p.kind === opener.kind);
    if (!exists) {
      const problem: Problem = {
        id: `prob-${event.id}`,
        kind: opener.kind,
        summary: opener.summary,
        severity: opener.severity,
        openedByEventId: event.id,
        openedAt: event.timestamp,
      };
      next.activeProblems.push(problem);
    }
    if (opener.kind === "runtime_error") {
      next.environment.processes = setProcess(next.environment.processes, "API", "failed");
    }
  }

  // Close a problem
  const closerKind = PROBLEM_CLOSERS[event.type];
  if (closerKind) {
    next.activeProblems = next.activeProblems.filter((p) => p.kind !== closerKind);
    if (closerKind === "runtime_error") {
      next.environment.processes = setProcess(next.environment.processes, "API", "healthy");
    }
  }

  // Specific event handling
  switch (event.type) {
    case "user.opened_file": {
      const path = str(event.payload.path);
      if (path) {
        const files = new Set(next.environment.files ?? []);
        files.add(path);
        next.environment.files = [...files];
        next.activeContext.focusedEntity = path;
      }
      break;
    }
    case "user.changed_goal": {
      const label = str(event.payload.goal);
      if (label) next.currentGoal = { id: `goal-${event.id}`, label, createdAt: event.timestamp };
      break;
    }
    case "user.focus_changed": {
      const componentId = str(event.payload.componentId);
      next.attention = {
        typing: event.payload.typing === true,
        focusedComponentId: componentId,
        lastInteractionAt: event.timestamp,
      };
      break;
    }
    case "system.resource_warning": {
      next.environment.processes = setProcess(next.environment.processes, "host", "degraded");
      break;
    }
  }

  return next;
}
