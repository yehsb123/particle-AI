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
 *   5. That picture READ by a model, with DM_SCREEN_READ=1 on top of the above
 *      → `sensor.screen_read { activity, summary, topics, … }` (the pixels go to the model)
 *
 *   DM_WATCH_PATHS=. pnpm agent
 *   pnpm test 2>&1 | pnpm agent
 *   DM_WATCH_WINDOWS=1 pnpm agent
 *   DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk pnpm agent
 *   DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk DM_SCREEN_READ=1 pnpm agent
 *
 * The fourth sense is the only one that reads what is IN a window rather than the shape of one,
 * so it is the only one that takes two switches and a list of apps (docs/CONSENT_V2.md). What it
 * sends is that it photographed, which app, and where the file landed — never the picture.
 *
 * The fifth is the moment the picture itself leaves the disk: it is handed to a model, which is
 * a separate switch again, off by default, and with no key configured the model is the
 * deterministic one and the pixels go no further than this process.
 *
 * Nothing runs unless you opt in with DM_WATCH_PATHS, DM_WATCH_WINDOWS or a pipe. Events go to
 * the LOCAL runtime.
 */
import { watch, existsSync, statSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { captureFileName, captureWith, defaultCaptureRegistry, readCaptureConfig, type CaptureFrame } from "@particle/screen-capture";
// the brains, through their own abstraction: this agent names no AI service and never will —
// which one reads a picture is the router's answer, and with no key it is the deterministic one
import { IntelligenceRouter, buildDefaultProviders, readScreen, supportsVision, SCREEN_READING_PURPOSE } from "@particle/intelligence";
import { relPath, isIgnored, identifier, ingestUrl, createReadQueue, matterEvent, OutputTracker, branchFromHead, gitDirFrom, healthWarning, createSendQueue, envNumber, envFlag, windowScript, windowSensor, WindowTracker, parseWindowLine, windowShape, captureApps, CaptureSchedule, screenLayers, screenSensor, screenReader, screenReadPayload, type Signal, type WindowShape } from "./shape";

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
// the second deliberate act: a picture is taken with the switches above, and READ with this one.
// Off, and with it off a frame stays on the disk it was written to and no model is handed it.
const WANT_READ = envFlag(process.env.DM_SCREEN_READ, "DM_SCREEN_READ");

// Sends are serialized: transitions are meaningful only in ORDER (failed → ok → failed), and
// parallel fetches may arrive reordered. One in-flight request at a time, best-effort.
const queue = createSendQueue(async (event) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (TOKEN) headers["x-particle-token"] = TOKEN;
  const res = await fetch(ingestUrl(RUNTIME), {
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
    // Queued, not read here. The reading takes as long as a model takes, and doing it inside
    // this lock meant the next picture of ANY app waited on it: the camera stopped taking
    // pictures because a model was thinking. The queue still reads one at a time, which is what
    // the lock was actually protecting - two readings of one window must not race to the runtime.
    reads?.push(frame);
  } catch (err) {
    // a sense that cannot see something says so; it does not take the agent down with it, and an
    // unhandled rejection out of a background capture would do exactly that
    process.stderr.write(`[particle-agent] no picture of ${app}: ${(err as Error).message}\n`);
  } finally {
    photographing = false;
  }
}

/**
 * One picture, read.
 *
 * This is the only place in this repository where pixels leave the disk they were written to.
 * The frame is handed to whichever brain the router chose for a picture, and what comes back is
 * a reading or nothing: a model that answers with prose, with a word nobody defined, or with an
 * instruction aimed at this log produces no reading and nothing is sent.
 *
 * `brain` being null is this layer being off, which is its default. The router is built once, at
 * startup, and only when somebody asked for reading.
 */
let brain: IntelligenceRouter | null = null;
/**
 * The pictures waiting to be read, or null when nobody asked for reading - which is the
 * default. No switch, no queue, no worker: this staying null IS the consent boundary.
 */
let reads: ReturnType<typeof createReadQueue<CaptureFrame>> | null = null;
async function readWindow(frame: CaptureFrame): Promise<void> {
  if (!brain) return;
  let bytes: Buffer;
  try {
    bytes = readFileSync(frame.path);
  } catch (err) {
    process.stderr.write(`[particle-agent] ${frame.app} photographed but not read: ${(err as Error).message}\n`);
    return;
  }
  // asking which brain reads is itself a step that can fail — a provider answering for its own
  // health is free to throw — and a picture that was taken says so even when nothing read it
  let result: Awaited<ReturnType<typeof readScreen>>;
  try {
    const { provider } = await brain.route({ purpose: SCREEN_READING_PURPOSE, capability: "vision" });
    result = await readScreen(provider, {
      bytes,
      // this package writes png and refuses any other extension (captureEnv in screen-capture)
      mediaType: "image/png",
      app: frame.app,
      window: frame.window,
      width: frame.width,
      height: frame.height,
    });
  } catch (err) {
    process.stderr.write(`[particle-agent] ${frame.app} photographed but not read: ${(err as Error).message}\n`);
    return;
  }
  if (!result.ok) {
    process.stderr.write(`[particle-agent] ${frame.app} photographed but not read: ${result.reason}\n`);
    return;
  }
  void send(
    matterEvent(
      SESSION,
      "sensor",
      "sensor.screen_read",
      "debug",
      screenReadPayload(result.reading, {
        app: frame.app,
        window: frame.window,
        path: frame.path,
        providerId: result.providerId,
        ...(result.modelId === undefined ? {} : { modelId: result.modelId }),
      }),
    ),
  );
  process.stderr.write(
    `[particle-agent] ${frame.app} read by ${result.providerId}: ${result.reading.activity} · ${result.reading.summary}\n`,
  );
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
      "  …the same with DM_SCREEN_READ=1        # and read by a model (the pixels go to it)",
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
// which brains this process holds is read once; the router asks them again per picture
const brains = WANT_READ ? buildDefaultProviders(process.env) : [];
const reader = screenReader(WANT_READ, sensingScreen, brains.filter(supportsVision).map((p) => p.id));
// asking for reading and getting none is never silent; not asking for it is
if (reader.note) process.stderr.write(reader.note + "\n");
if (reader.run) {
  brain = new IntelligenceRouter(brains);
  reads = createReadQueue<CaptureFrame>((frame) => readWindow(frame), {
    // A picture taken and never read leaves no trace anywhere else: the runtime never hears of
    // it, and whoever turned reading on sees a gap in the readings with nothing to explain it.
    onDrop: (frame, dropped) =>
      process.stderr.write(`[particle-agent] ${frame.app} photographed but not read: readings are behind (${dropped} unread so far)\n`),
    onError: (err) =>
      process.stderr.write(`[particle-agent] a reading failed: ${err instanceof Error ? err.message : String(err)}\n`),
  });
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
