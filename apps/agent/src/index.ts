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
import { watch, existsSync, statSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { relPath, isIgnored, matterEvent, OutputTracker, branchFromHead, gitDirFrom, healthWarning, createSendQueue, type Signal } from "./shape";

const RUNTIME = process.env.DM_RUNTIME_URL ?? "http://localhost:8787";
const SESSION = process.env.DM_AGENT_SESSION ?? "desktop";
const WATCH = (process.env.DM_WATCH_PATHS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const DEBOUNCE_MS = Number(process.env.DM_AGENT_DEBOUNCE_MS ?? 400);
const TOKEN = process.env.DM_INGEST_TOKEN ?? "";

// Sends are serialized: transitions are meaningful only in ORDER (failed → ok → failed), and
// parallel fetches may arrive reordered. One in-flight request at a time, best-effort.
const queue = createSendQueue(async (event) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (TOKEN) headers["x-particle-token"] = TOKEN;
  const res = await fetch(`${RUNTIME}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5_000), // a hung endpoint must not stall sensing for minutes
  });
  if (!res.ok) {
    process.stderr.write(`[particle-agent] runtime rejected ${(event as { type?: string }).type}: ${res.status}\n`);
  }
});
function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  return queue.send(event);
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

function gitDir(root: string): string | null {
  const dot = join(root, ".git");
  if (!existsSync(dot)) return null;
  const isDir = statSync(dot).isDirectory();
  let text: string | undefined;
  if (!isDir) {
    try { text = readFileSync(dot, "utf8"); } catch { return null; }
  }
  return gitDirFrom(root, isDir, text, (base, p) => resolve(base, p));
}

/**
 * Branch switches are a strong context-switch signal. Instead of polling `git`, watch the git
 * directory for changes to HEAD (checkout rewrites it) and send the branch NAME only.
 */
function watchGitBranch(root: string): boolean {
  const dir = gitDir(root);
  if (!dir) return false;
  const head = join(dir, "HEAD");
  const read = (): string | undefined => {
    try { return branchFromHead(readFileSync(head, "utf8")); } catch { return undefined; }
  };
  let last = read();
  let timer: NodeJS.Timeout | undefined;
  const check = () => {
    const branch = read();
    if (!branch || branch === last) return;
    if (last === undefined) { last = branch; return; } // first readable HEAD is the baseline, not a switch
    last = branch;
    void send(matterEvent(SESSION, "user", "user.action", "debug", { key: `branch:${branch}` }));
  };
  try {
    const w = watch(dir, (_kind, filename) => {
      if (filename && filename.toString() !== "HEAD") return; // index/refs churn is not a switch
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 150); // checkout writes HEAD via a temp file + rename
    });
    w.on("error", (e) => process.stderr.write(`[particle-agent] git watcher error for ${root}: ${(e as Error).message}\n`));
  } catch (e) {
    process.stderr.write(`[particle-agent] cannot watch ${head}: ${(e as Error).message}\n`);
    return false;
  }
  process.stderr.write(`[particle-agent] sensing git branch switches in ${root} (branch name only)\n`);
  return true;
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
// one startup probe: sensing stays best-effort, but a silent black hole helps nobody
void fetch(`${RUNTIME}/health`, { signal: AbortSignal.timeout(2_000) })
  .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
  .catch(() => {
    const w = healthWarning(RUNTIME, false);
    if (w) process.stderr.write(w + "\n");
  });

if (WATCH.length > 0) watchPaths(WATCH);
const gitRoots = WATCH.map((p) => resolve(p)).filter((r) => watchGitBranch(r));
if (piped) pipeOutput();
// tell the runtime what this sensor observes, so the body's "sensing" indicator is honest
const layers = [...(WATCH.length ? ["files"] : []), ...(gitRoots.length ? ["git"] : []), ...(piped ? ["output"] : [])];
void send(matterEvent(SESSION, "sensor", "sensor.layers_changed", "debug", { sensor: "agent", layers }));
