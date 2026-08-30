import type { MatterEvent, Problem, ProcessState, WorldState } from "@particle/contracts";
import { RECENT_EVENTS_LIMIT } from "@particle/contracts";

const PROBLEM_OPENERS: Record<string, { kind: string; summary: string; severity: "warning" | "critical" }> = {
  "development.server_error": { kind: "runtime_error", summary: "Service returned a runtime error", severity: "critical" },
  "development.build_failed": { kind: "build_failure", summary: "Build failed", severity: "warning" },
  "development.test_failed": { kind: "test_failure", summary: "Tests failed", severity: "warning" },
  "security.vulnerability_detected": { kind: "security_alert", summary: "Vulnerable dependency detected", severity: "critical" },
};

/** Which problem kind an event resolves. */
const PROBLEM_CLOSERS: Record<string, string> = {
  "development.server_recovered": "runtime_error",
  "development.build_succeeded": "build_failure",
  "development.test_passed": "test_failure",
  "security.vulnerability_patched": "security_alert",
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

  // ── Behavior (Concept v2): L0–L3 sensing events fold into world.behavior ──
  const b = { ...prev.behavior, recentEntities: [...prev.behavior.recentEntities] };
  switch (event.type) {
    case "user.interaction": {
      // { kind: click|scroll|hover|key, target? } — shape only, never content
      b.interactions += 1;
      b.lastInteractionAt = event.timestamp;
      b.idleSeconds = 0;
      b.awaySeconds = 0;
      break;
    }
    case "user.idle": {
      b.idleSeconds = Number(event.payload.seconds ?? 0) || 0;
      break;
    }
    case "user.visibility": {
      // { visible: boolean, awaySeconds?: number } — returning after being away
      if (event.payload.visible === true) b.awaySeconds = Number(event.payload.awaySeconds ?? 0) || 0;
      else b.awaySeconds = 0;
      break;
    }
    case "user.action": {
      // { key: string } — a semantic action (re-run, retry, open X…); repeats signal stuckness
      const key = str(event.payload.key);
      if (key) {
        b.repeatCount = key === b.lastActionKey ? b.repeatCount + 1 : 1;
        b.lastActionKey = key;
        b.awaySeconds = 0;
      }
      break;
    }
    case "user.requested_undo": {
      b.undoCount += 1;
      break;
    }
    case "user.opened_file": {
      const path = str(event.payload.path);
      if (path) {
        b.recentEntities = [...b.recentEntities.filter((e) => e !== path), path].slice(-8);
        b.repeatCount = path === b.lastActionKey ? b.repeatCount + 1 : 1;
        b.lastActionKey = path;
      }
      break;
    }
    case "network.request": {
      // L2 shape: { host, status?, ms?, error? } — never URL path/query/body
      const host = str(event.payload.host) ?? "unknown";
      const status = Number(event.payload.status ?? 0) || 0;
      const ms = Number(event.payload.ms ?? 0) || 0;
      const failed = event.payload.error === true || status >= 500;
      const net = { ...b.network, failingHosts: [...b.network.failingHosts] };
      net.requests += 1;
      if (ms >= 2000) net.slow += 1;
      if (failed) {
        net.failures += 1;
        net.failingHosts = [host, ...net.failingHosts.filter((h) => h !== host)].slice(0, 5);
        if (!next.activeProblems.some((p) => p.kind === "network_failure")) {
          next.activeProblems.push({
            id: `prob-${event.id}`,
            kind: "network_failure",
            summary: `${host} is failing (${status || "network error"})`,
            severity: "warning",
            openedByEventId: event.id,
            openedAt: event.timestamp,
          });
        }
      } else if (status > 0 && status < 400) {
        // a later success to a failing host clears the network problem
        net.failingHosts = net.failingHosts.filter((h) => h !== host);
        if (net.failingHosts.length === 0) {
          next.activeProblems = next.activeProblems.filter((p) => p.kind !== "network_failure");
        }
      }
      b.network = net;
      break;
    }
  }
  next.behavior = b;

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
    case "sensor.layers_changed": {
      // a sensor declares (or revokes) what it observes; empty layers remove the sensor entirely
      const sensor = str(event.payload.sensor) ?? "unknown";
      const layers = Array.isArray(event.payload.layers)
        ? (event.payload.layers as unknown[]).filter((l): l is string => typeof l === "string").slice(0, 16)
        : [];
      const sensing = { ...(next.sensing ?? {}) };
      if (layers.length) sensing[sensor] = layers;
      else delete sensing[sensor];
      next.sensing = sensing;
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
