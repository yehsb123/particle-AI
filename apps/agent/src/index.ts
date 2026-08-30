#!/usr/bin/env tsx
/**
 * Particle AI — desktop agent (Concept v2, layer L4 — OPT-IN).
 *
 * Two senses, both shape-only:
 *   1. File saves under DM_WATCH_PATHS  → `user.opened_file { path }` (relative path, never content)
 *   2. Piped tool output (stdin)        → `development.test_failed/passed`, `development.build_failed/succeeded`
 *      (transitions only — the output itself is passed through to your terminal untouched)
 *
 *   DM_WATCH_PATHS=. pnpm agent
 *   pnpm test 2>&1 | pnpm agent
 *
 * Nothing runs unless you opt in with DM_WATCH_PATHS or a pipe. Events go to the LOCAL runtime.
 */
import { watch, existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { relPath, isIgnored, matterEvent, OutputTracker, type Signal } from "./shape";

const RUNTIME = process.env.DM_RUNTIME_URL ?? "http://localhost:8787";
const SESSION = process.env.DM_AGENT_SESSION ?? "desktop";
const WATCH = (process.env.DM_WATCH_PATHS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const DEBOUNCE_MS = Number(process.env.DM_AGENT_DEBOUNCE_MS ?? 400);
const TOKEN = process.env.DM_INGEST_TOKEN ?? "";

async function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (TOKEN) headers["x-particle-token"] = TOKEN;
    const res = await fetch(`${RUNTIME}/api/events`, { method: "POST", headers, body: JSON.stringify(event) });
    if (!res.ok) process.stderr.write(`[particle-agent] runtime rejected ${event.type}: ${res.status}\n`);
  } catch {
    /* runtime offline — sensing is best-effort and local */
  }
}

function watchPaths(paths: string[]): void {
  const pending = new Map<string, NodeJS.Timeout>();
  for (const p of paths) {
    const root = resolve(p);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      process.stderr.write(`[particle-agent] not a directory, skipped: ${p}\n`);
      continue;
    }
    const watcher = watch(root, { recursive: true }, (_kind, filename) => {
      if (!filename) return;
      const rel = relPath(root, resolve(root, filename.toString()));
      if (isIgnored(rel)) return;
      const prev = pending.get(rel);
      if (prev) clearTimeout(prev);
      pending.set(
        rel,
        setTimeout(() => {
          pending.delete(rel);
          void send(matterEvent(SESSION, "user", "user.opened_file", "debug", { path: rel }));
        }, DEBOUNCE_MS),
      );
    });
    // never crash the daemon on watcher errors (inotify limits, deleted roots) — degrade to git/output only
    watcher.on("error", (e) => process.stderr.write(`[particle-agent] watcher error for ${root}: ${(e as Error).message}\n`));
    process.stderr.write(`[particle-agent] sensing file saves under ${root} (relative paths only)\n`);
  }
}

/** Branch switches are a strong context-switch signal: `git rev-parse --abbrev-ref HEAD` polled, name only. */
function watchGitBranch(root: string, everyMs = 3000): void {
  let last: string | undefined;
  const tick = () =>
    execFile("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }, (err, out) => {
      if (err) return;
      const branch = out.trim();
      if (!branch || branch === last) return;
      const first = last === undefined;
      last = branch;
      if (!first) void send(matterEvent(SESSION, "user", "user.action", "debug", { key: `branch:${branch}` }));
    });
  tick();
  setInterval(tick, everyMs);
  process.stderr.write(`[particle-agent] sensing git branch switches in ${root} (branch name only)\n`);
}

function pipeOutput(): void {
  const tracker = new OutputTracker();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    process.stdout.write(line + "\n"); // pass-through: your terminal sees exactly what the tool printed
    const sig: Signal | null = tracker.feed(line);
    if (sig) void send(matterEvent(SESSION, sig.source, sig.type, sig.severity, sig.payload));
  });
  process.stderr.write(`[particle-agent] sensing test/build transitions from stdin (summary lines only)\n`);
}

const piped = !process.stdin.isTTY;
if (WATCH.length === 0 && !piped) {
  process.stdout.write(
    [
      "particle-agent is OPT-IN and does nothing until you choose a sense:",
      "  DM_WATCH_PATHS=.   pnpm agent          # file saves (relative paths only)",
      "  pnpm test 2>&1 | pnpm agent            # test/build pass↔fail transitions",
      `runtime: ${RUNTIME}   session: ${SESSION}   (open the body with ?connect=1&session=${SESSION})`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}
if (WATCH.length > 0) watchPaths(WATCH);
const gitRoots = WATCH.map((p) => resolve(p)).filter((r) => existsSync(join(r, ".git")));
for (const r of gitRoots) watchGitBranch(r);
if (piped) pipeOutput();
// tell the runtime what this sensor observes, so the body's "sensing" indicator is honest
const layers = [...(WATCH.length ? ["files"] : []), ...(gitRoots.length ? ["git"] : []), ...(piped ? ["output"] : [])];
void send(matterEvent(SESSION, "sensor", "sensor.layers_changed", "debug", { sensor: "agent", layers }));
