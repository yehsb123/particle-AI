#!/usr/bin/env tsx
/**
 * Particle AI — desktop agent (Concept v2, layer L4 — OPT-IN).
 *
 * Two senses, both shape-only:
 *   1. File saves under DM_WATCH_PATHS  → `user.opened_file { path }` (relative path, never content)
 *   2. Piped tool output (stdin)        → `development.test_failed/passed`, `development.build_failed/succeeded`
 *      (transitions only — the output itself is passed through to your terminal untouched)
 *   3. The window in front, with DM_WATCH_WINDOWS → `user.focused_window { app, window }`
 *      (Windows only, changes only — the program name and the window title, never what is in it)
 *   4. A picture of a LISTED app's window, with DM_CAPTURE=1 and DM_CAPTURE_APPS
 *      → `sensor.captured_window { app, window, path, … }` (the file stays on this machine)
 *
 *   DM_WATCH_PATHS=. pnpm agent
 *   pnpm test 2>&1 | pnpm agent
 *   DM_WATCH_WINDOWS=1 pnpm agent
 *   DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk pnpm agent
 *
 * The fourth sense is the only one that reads what is IN a window rather than the shape of one,
 * so it is the only one that takes two switches and a list of apps (docs/CONSENT_V2.md). What it
 * sends is that it photographed, which app, and where the file landed — never the picture.
 *
 * Nothing runs unless you opt in with DM_WATCH_PATHS, DM_WATCH_WINDOWS or a pipe. Events go to
 * the LOCAL runtime.
 */
import { watch, existsSync, statSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { captureFileName, captureWith, defaultCaptureRegistry, readCaptureConfig } from "@particle/screen-capture";
import { relPath, isIgnored, identifier, matterEvent, OutputTracker, branchFromHead, gitDirFrom, healthWarning, createSendQueue, envNumber, envFlag, windowScript, windowSensor, WindowTracker, parseWindowLine, windowShape, captureApps, CaptureSchedule, screenLayers, screenSensor, type Signal, type WindowShape } from "./shape";

const RUNTIME = process.env.DM_RUNTIME_URL ?? "http://localhost:8787";
const SESSION = process.env.DM_AGENT_SESSION ?? "desktop";
const WATCH = (process.env.DM_WATCH_PATHS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// a timer past the 32-bit maximum is clamped to 1ms by setTimeout, which is the debounce gone
const DEBOUNCE_MS = envNumber(process.env.DM_AGENT_DEBOUNCE_MS, 400, "DM_AGENT_DEBOUNCE_MS", 1, 2_147_483_647);
const TOKEN = process.env.DM_INGEST_TOKEN ?? "";
// the widest of this agent's senses — the window in front is the whole desktop, not one repository
const WANT_WINDOWS = envFlag(process.env.DM_WATCH_WINDOWS, "DM_WATCH_WINDOWS");
const WINDOW_MS = envNumber(process.env.DM_AGENT_WINDOW_MS, 1_000, "DM_AGENT_WINDOW_MS", 100, 600_000);
// the one sense that reads what is IN a window: the apps somebody listed, and nothing else
const CAPTURE_APPS = captureApps(process.env.DM_CAPTURE_APPS, "DM_CAPTURE_APPS");
// a minute between two pictures of one app; the window in front is read every second, so the
// floor is what stands between an afternoon in a chat window and an afternoon of pictures of it
const CAPTURE_MS = envNumber(process.env.DM_AGENT_CAPTURE_MS, 60_000, "DM_AGENT_CAPTURE_MS", 1_000, 86_400_000);
const CAPTURE = readCaptureConfig(process.env);

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
          void send(matterEvent(SESSION, "user", "user.opened_file", "debug", { path: identifier(rel) }));
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
  // A .git file can name any directory, which is how a worktree points at the real one — so the
  // watch follows it only where a branch can actually be read. Somebody else's file naming a
  // directory nobody opted into does not get a watcher on this machine.
  if (last === undefined) {
    process.stderr.write(`[particle-agent] no readable HEAD in ${dir}, not watching it\n`);
    return false;
  }
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

/**
 * The window in front, read through Windows UI Automation.
 *
 * The reading runs in one long-lived PowerShell process that prints a line per tick, rather than
 * a process per tick: starting one costs a few seconds (it compiles the one P/Invoke it needs),
 * which would be most of a one-second interval spent starting readers. This agent keeps no
 * runtime dependencies, so a native module to do the same is not on the table.
 *
 * The script is passed as an encoded command rather than on stdin. It is a multi-line script with
 * a here-string in it, and PowerShell reading that from stdin parses it as console input and exits
 * without ever running it — measured here, and a sensor that silently never reports is the worst
 * way for this to fail.
 */
function watchWindows(intervalMs: number, onReading?: (shape: WindowShape) => void): boolean {
  const tracker = new WindowTracker();
  const encoded = Buffer.from(windowScript(intervalMs, process.pid), "utf16le").toString("base64");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      // stderr is the CLIXML stream PowerShell writes when it is redirected: not readable as
      // text, and the reader dying is what actually matters, which `exit` below reports
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    process.stderr.write(`[particle-agent] cannot read the window in front: ${(e as Error).message}\n`);
    return false;
  }
  child.on("error", (e) => process.stderr.write(`[particle-agent] window reader failed to start: ${e.message}\n`));
  child.on("exit", (code) => process.stderr.write(`[particle-agent] window reader stopped (${code}) — windows are no longer sensed\n`));
  // the reader senses the whole desktop: it must not outlive the agent somebody stopped
  const stop = (): void => { try { child.kill(); } catch { /* already gone */ } };
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { stop(); process.exit(0); });
  }
  const readings = child.stdout;
  if (!readings) {
    // a reader nobody can read from would sense the desktop and report none of it
    process.stderr.write("[particle-agent] window reader gave nothing to read — windows are not sensed\n");
    stop();
    return false;
  }
  readings.setEncoding("utf8");
  createInterface({ input: readings, crlfDelay: Infinity }).on("line", (line) => {
    const read = parseWindowLine(line);
    const shape = read ? windowShape(read.app, read.title) : null;
    if (!shape) return;
    // every reading, not only the changes: the screen layer photographs the window somebody is
    // sitting in, which is the same window reading after reading
    onReading?.(shape);
    const sig: Signal | null = tracker.feedShape(shape);
    if (sig) void send(matterEvent(SESSION, sig.source, sig.type, sig.severity, sig.payload));
  });
  process.stderr.write(`[particle-agent] sensing the window in front every ${intervalMs}ms (program name and window title only)\n`);
  return true;
}

/**
 * One picture of one listed app's window.
 *
 * The window is asked for BY PROGRAM NAME rather than as "whatever is in front", although the
 * reading that led here was a foreground reading: the picture is taken moments later, and in
 * those moments the person may have switched to a window they never listed. Naming the program
 * means the only window this can come back with belongs to an app they did.
 *
 * The frame stays on this machine. What is sent is that a picture was taken, of which app, and
 * where it landed — the absolute path, which is the one place in this agent a path is not made
 * relative, because a file nobody can find is the opposite of what this layer owes a person who
 * turned it on. Deleting them is `DM_CAPTURE_DIR`'s directory, or the temp directory.
 */
const cameras = defaultCaptureRegistry();
let photographing = false;
async function photograph(app: string): Promise<void> {
  // a floor of one second is allowed, and a capture takes longer than that on first use: two
  // PowerShell processes each compiling .NET to draw the same window is nobody's intention
  if (photographing) {
    process.stderr.write(`[particle-agent] no picture of ${app}: another one is still being taken\n`);
    return;
  }
  photographing = true;
  try {
    const target = { kind: "app", app } as const;
    const path = join(CAPTURE.dir || tmpdir(), captureFileName(target, new Date()));
    const result = await captureWith(CAPTURE, cameras, { target, path });
    if (!result.ok) {
      process.stderr.write(`[particle-agent] no picture of ${app}: ${result.reason}\n`);
      return;
    }
    const { frame } = result;
    void send(
      matterEvent(SESSION, "sensor", "sensor.captured_window", "debug", {
        app: identifier(frame.app),
        window: identifier(frame.window),
        path: frame.path,
        width: frame.width,
        height: frame.height,
        bytes: frame.bytes,
        backend: frame.backend,
      }),
    );
    process.stderr.write(`[particle-agent] photographed ${frame.app} · ${frame.width}x${frame.height} → ${frame.path}\n`);
  } catch (err) {
    // a sense that cannot see something says so; it does not take the agent down with it, and an
    // unhandled rejection out of a background capture would do exactly that
    process.stderr.write(`[particle-agent] no picture of ${app}: ${(err as Error).message}\n`);
  } finally {
    photographing = false;
  }
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
const windows = windowSensor(process.platform, WANT_WINDOWS);
// asked for on a machine that cannot read it: said once, to the person who asked
if (windows.note) process.stderr.write(windows.note + "\n");
const screen = screenSensor(process.platform, CAPTURE.enabled, CAPTURE_APPS, windows.run);
// listing apps and getting no pictures is never silent; listing none is
if (screen.note) process.stderr.write(screen.note + "\n");
if (WATCH.length === 0 && !piped && !windows.run) {
  process.stdout.write(
    [
      "particle-agent is OPT-IN and does nothing until you choose a sense:",
      "  DM_WATCH_PATHS=.   pnpm agent          # file saves (relative paths only)",
      "  pnpm test 2>&1 | pnpm agent            # test/build pass↔fail transitions",
      "  DM_WATCH_WINDOWS=1 pnpm agent          # the window in front (Windows; app + title only)",
      "  DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk pnpm agent",
      "                                         # a picture of those apps' windows, kept on this machine",
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
const schedule = screen.run ? new CaptureSchedule(CAPTURE_APPS, CAPTURE_MS) : null;
const sensingWindows =
  windows.run &&
  watchWindows(WINDOW_MS, schedule ? (shape) => {
    const app = schedule.claim(shape.app, Date.now());
    if (app) void photograph(app);
  } : undefined);
// the reader failing to start takes the screen layer with it: it has nothing to photograph from
const sensingScreen = sensingWindows && screen.run;
if (sensingScreen) {
  process.stderr.write(`[particle-agent] photographing ${CAPTURE_APPS.join(", ")} at most every ${CAPTURE_MS}ms into ${CAPTURE.dir || tmpdir()} (the files stay there)\n`);
}
// tell the runtime what this sensor observes, so the body's "sensing" indicator is honest
const layers = [
  ...(WATCH.length ? ["files"] : []),
  ...(gitRoots.length ? ["git"] : []),
  ...(piped ? ["output"] : []),
  ...(sensingWindows ? ["windows"] : []),
  ...(sensingScreen ? screenLayers(CAPTURE_APPS) : []),
];
void send(matterEvent(SESSION, "sensor", "sensor.layers_changed", "debug", { sensor: "agent", layers }));
