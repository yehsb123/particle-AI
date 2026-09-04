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

/** Longest identifier the world state will hold. Anything longer is not an identifier. */
const MAX_IDENTIFIER = 120;

/**
 * Every payload string that becomes part of the belief comes through here. The sensors send
 * identifiers — a path, a host, an action key — but the ingest API accepts whatever a client
 * posts, and these values are read back out by capabilities, rendered into cards and written to
 * snapshots. One long enough to be prose is trimmed, visibly.
 */
/** A duration in seconds from a payload: a real, non-negative number, or nothing at all. */
function seconds(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.length > MAX_IDENTIFIER ? `${v.slice(0, MAX_IDENTIFIER)}…` : v;
}

/**
 * How many sensors one session tracks. There are three of them — the body, the extension, the
 * desktop agent — and the name comes from an event payload, so this is a ceiling rather than a
 * limit anyone should meet.
 */
const MAX_SENSORS = 16;

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
  // System ticks (reconcile) are bookkeeping, not the person's activity: they stay out of the
  // novelty window so repeated real events are still recognised as repetitive. Pure either way —
  // replay determinism is untouched.
  const recentEvents =
    event.type === "runtime.reconcile"
      ? prev.recentEvents
      : [...prev.recentEvents, event].slice(-RECENT_EVENTS_LIMIT);
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
  // An event type is any string a client sends, and these are plain objects: without an own-key
  // check, a type of "toString" hands back a function, opens a problem with no kind, no summary
  // and no severity — a world state that fails its own schema — and nothing can ever close it.
  const opener = Object.hasOwn(PROBLEM_OPENERS, event.type) ? PROBLEM_OPENERS[event.type] : undefined;
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
  const closerKind = Object.hasOwn(PROBLEM_CLOSERS, event.type) ? PROBLEM_CLOSERS[event.type] : undefined;
  if (closerKind) {
    next.activeProblems = next.activeProblems.filter((p) => p.kind !== closerKind);
    if (closerKind === "runtime_error") {
      next.environment.processes = setProcess(next.environment.processes, "API", "healthy");
    }
  }

  // ── Behavior (Concept v2): L0–L3 sensing events fold into world.behavior ──
  const b = { ...prev.behavior, recentEntities: [...prev.behavior.recentEntities], recentKeys: [...(prev.behavior.recentKeys ?? [])] };
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
      b.idleSeconds = seconds(event.payload.seconds);
      break;
    }
    case "user.visibility": {
      // { visible: boolean, awaySeconds?: number } — returning after being away
      if (event.payload.visible === true) b.awaySeconds = seconds(event.payload.awaySeconds);
      else b.awaySeconds = 0;
      break;
    }
    case "user.action": {
      // { key: string } — a semantic action (re-run, retry, open X…); repeats signal stuckness
      const key = str(event.payload.key);
      if (key) {
        b.repeatCount = key === b.lastActionKey ? b.repeatCount + 1 : 1;
        b.lastActionKey = key;
        b.recentKeys = [...b.recentKeys, key].slice(-8);
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
        b.recentKeys = [...b.recentKeys, path].slice(-8);
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
        files.delete(path);
        files.add(path); // most recent last
        next.environment.files = [...files].slice(-50); // bounded: fed by every navigation (site:<host>)
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
      if (layers.length) {
        // Assigning by key would set the prototype for a sensor called "__proto__", leaving a
        // sensing map that looks empty and a world state that fails its own schema — from one
        // posted event. defineProperty writes an own property whatever the name is.
        if (Object.hasOwn(sensing, sensor) || Object.keys(sensing).length < MAX_SENSORS) {
          Object.defineProperty(sensing, sensor, { value: layers, enumerable: true, writable: true, configurable: true });
        }
      } else delete sensing[sensor];
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
