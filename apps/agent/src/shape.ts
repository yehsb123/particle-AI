/**
 * Particle AI desktop agent — shaping (Concept v2 rule #1: shape, never content).
 * Every byte the agent sends is derived through these pure helpers, so reviewing this file is
 * reviewing what can possibly leave the machine: relative paths and pass/fail transitions.
 */
import { relative, sep } from "node:path";

/** Directories that are noise for intent (build output, deps, VCS internals). */
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "coverage", ".cache", "build", "out"]);

/** Relative, forward-slash path — never the absolute location on disk. */
export function relPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/").replace(/\\/g, "/");
}

export function isIgnored(rel: string): boolean {
  if (!rel || rel.startsWith("..")) return true;
  const parts = rel.split("/");
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  const base = parts[parts.length - 1] ?? "";
  // editor temp/swap files and lockfiles are not "the user working on something"
  return base.startsWith(".") || base.endsWith("~") || base.endsWith(".swp") || base.endsWith(".tmp") || base.endsWith(".lock");
}

/**
 * Branch name from the text of `.git/HEAD` — "ref: refs/heads/main" → "main"; a detached HEAD
 * becomes "detached@<short sha>". Anything else is undefined (never sent).
 */
export function branchFromHead(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t);
  if (ref?.[1]) return ref[1].trim();
  return /^[0-9a-f]{7,40}$/i.test(t) ? `detached@${t.slice(0, 7)}` : undefined;
}

/** Resolve the git directory for a root: `.git` as a directory, or a worktree's `gitdir:` file. */
export function gitDirFrom(root: string, dotGitIsDir: boolean, dotGitText: string | undefined, resolvePath: (base: string, p: string) => string): string | null {
  if (dotGitIsDir) return resolvePath(root, ".git");
  const m = /^gitdir:\s*(.+)$/m.exec(dotGitText ?? "");
  return m?.[1] ? resolvePath(root, m[1].trim()) : null;
}

/** One-line startup warning when the runtime is unreachable (sensing stays best-effort). */
export function healthWarning(runtimeUrl: string, reachable: boolean): string | null {
  return reachable ? null : `[particle-agent] runtime not reachable at ${runtimeUrl} — events are dropped until it is up (pnpm runtime)`;
}

export type Severity = "debug" | "info" | "warning" | "critical";
export type Source = "user" | "development" | "sensor";

/** MatterEvent-shaped object without importing the monorepo (the agent is standalone). */
export function matterEvent(
  sessionId: string,
  source: Source,
  type: string,
  severity: Severity,
  payload: Record<string, unknown>,
  now = new Date(),
) {
  return {
    id: `agent-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: now.toISOString(),
    source,
    type,
    severity,
    payload,
  };
}

// ── test / build output → transitions ──

export type Outcome = "test_fail" | "test_pass" | "build_fail" | "build_ok";

const FAILED_COUNT = /(\d+)\s+(?:failed|failing)\b/i;
const ERROR_COUNT = /Found\s+(\d+)\s+errors?/i;

/**
 * Classify one line of tool output. Summary lines only — vitest/jest/mocha/playwright totals,
 * tsc/next/vite build results. Anything else is null (and never sent).
 */
export function classifyLine(line: string): Outcome | null {
  const l = line.trim();
  if (!l) return null;
  // build — checked first: "error TS2345" lines are compiler, not test, failures
  if (/error TS\d+/.test(l) || /Failed to compile/i.test(l) || /Build failed/i.test(l) || /Found \d+ errors?/i.test(l)) return "build_fail";
  if (/Compiled successfully/i.test(l) || /✓ Compiled/.test(l) || /Build completed/i.test(l) || /\bbuilt in \d+/.test(l) || /Build succeeded/i.test(l)) return "build_ok";
  // tests — SUMMARY lines only. The bare "<n> failed / failing" forms must begin the line:
  // an app log piped through the agent says things like "GET /users/42 failed with 500" or
  // "3 failed login attempts", and neither is a test run changing state.
  if (
    /\bTests?:?\s+\d+\s+failed/i.test(l) ||
    /^\s*FAIL\b/.test(l) ||
    /^\s*\d+\s+failing\b/.test(l) ||
    /^\s*\d+\s+failed\b/.test(l)
  ) {
    return "test_fail";
  }
  if (/\bTests?:?\s+\d+\s+passed/i.test(l) || /^\s*\d+\s+passing\b/.test(l) || /^\s*\d+\s+passed\b/.test(l)) return "test_pass";
  return null;
}

export type Signal = { type: string; source: Source; severity: Severity; payload: Record<string, unknown> };

/**
 * Turns a stream of output lines into TRANSITIONS: the runtime hears "tests started failing"
 * and "tests pass again", not every line. Pure state machine.
 */
export class OutputTracker {
  private tests: "failing" | "passing" | null = null;
  private build: "failing" | "passing" | null = null;

  feed(line: string): Signal | null {
    const o = classifyLine(line);
    if (!o) return null;
    switch (o) {
      case "build_fail": {
        const n = Number(ERROR_COUNT.exec(line)?.[1] ?? 1);
        if (this.build === "failing") return null;
        this.build = "failing";
        return { type: "development.build_failed", source: "development", severity: "warning", payload: { errors: n } };
      }
      case "build_ok": {
        if (this.build === "passing") return null;
        const was = this.build;
        this.build = "passing";
        // a first-ever success is not news; a recovery is
        return was === "failing"
          ? { type: "development.build_succeeded", source: "development", severity: "info", payload: {} }
          : null;
      }
      case "test_fail": {
        const n = Number(FAILED_COUNT.exec(line)?.[1] ?? 1);
        if (this.tests === "failing") return null;
        this.tests = "failing";
        return { type: "development.test_failed", source: "development", severity: "warning", payload: { failing: n } };
      }
      case "test_pass": {
        if (this.tests === "passing") return null;
        const was = this.tests;
        this.tests = "passing";
        return was === "failing"
          ? { type: "development.test_passed", source: "development", severity: "info", payload: {} }
          : null;
      }
    }
  }
}
