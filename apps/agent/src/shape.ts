/**
 * Particle AI desktop agent — shaping (Concept v2 rule #1: shape, never content).
 * Every byte the agent sends is derived through these pure helpers, so reviewing this file is
 * reviewing what can possibly leave the machine: relative paths and pass/fail transitions.
 */
import { relative, sep } from "node:path";
// a type, which compiles to nothing: this module stays as reviewable and as dependency-free as
// the rule at the top of it says, and still speaks the same vocabulary as the runtime
import type { ScreenReading } from "@particle/contracts";

/** Directories that are noise for intent (build output, deps, VCS internals). */
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "coverage", ".cache", "build", "out"]);

/** Relative, forward-slash path — never the absolute location on disk. */
export function relPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/").replace(/\\/g, "/");
}

/** A path that is not plainly relative to the watched root: absolute, rooted, or climbing out. */
function escapesRoot(rel: string): boolean {
  // `path.relative` between two different Windows drives hands back the absolute target, so a
  // file on another drive would otherwise leave here spelled "D:/somewhere/private.txt".
  return rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\") || /^[a-zA-Z]:/.test(rel);
}

export function isIgnored(rel: string): boolean {
  if (!rel || escapesRoot(rel)) return true;
  const parts = rel.split("/");
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  // A dot directory anywhere in the path is configuration, not work — .ssh, .aws and .vscode
  // are nobody's business, and the name alone would say what someone was editing.
  if (parts.some((p) => p.startsWith("."))) return true;
  const base = parts[parts.length - 1] ?? "";
  // editor temp/swap files and lockfiles are not "the user working on something"
  return base.endsWith("~") || base.endsWith(".swp") || base.endsWith(".tmp") || base.endsWith(".lock");
}

/**
 * Branch name from the text of `.git/HEAD` — "ref: refs/heads/main" → "main"; a detached HEAD
 * becomes "detached@<short sha>". Anything else is undefined (never sent).
 */
/**
 * How much of a name this sensor will send. The same bound the runtime keeps (MAX_IDENTIFIER in
 * the contracts, asserted by this package's tests): a sensor sends a shape, and a shape has a
 * size. Trimming here as well as there means what leaves this machine is already a shape, rather
 * than something the receiver has to cut down after it has already been sent.
 */
export const MAX_NAME = 120;

/** Control characters: a name carrying an escape sequence is read by a terminal, not a person. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * A name this machine observed, made fit to send and to print.
 *
 * These come from outside: a branch name out of a file git wrote, a path out of the OS watcher, a
 * host out of a URL. None of them are bounded at the source, and a name is written into an event,
 * into cards someone reads, and into this process's own stderr — where an escape sequence is an
 * instruction to their terminal rather than a name anybody chose.
 */
export function identifier(name: unknown): string {
  if (typeof name !== "string") return "";
  const clean = name.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE, " ").trim();
  return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME)}…` : clean;
}

export function branchFromHead(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.trim();
  if (!t) return undefined;
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t);
  // a branch name is whatever git was told to call it, and .git/HEAD is a file like any other
  if (ref?.[1]) return identifier(ref[1]) || undefined;
  return /^[0-9a-f]{7,40}$/i.test(t) ? `detached@${t.slice(0, 7)}` : undefined;
}

/**
 * How long a path this sensor will follow. Every operating system stops well before this; a line
 * longer than it is not a path somebody wrote.
 */
export const MAX_PATH = 4_096;

/**
 * A number somebody put in the environment, or the default when they did not.
 *
 * The same reader the runtime uses (envNumber in the contracts, asserted by this package's
 * tests). This agent takes no dependencies on purpose — somebody runs it on their own machine —
 * so it carries its own copy, the way it carries its own MAX_NAME.
 *
 * `Number()` alone is the wrong reader. An empty value is the ordinary way an env file says
 * nothing, and `Number("")` is 0: measured, `DM_AGENT_DEBOUNCE_MS=` made the debounce zero, so
 * this sensor sent an event per save instead of one per burst, silently. Every malformed value
 * did the same — "abc" and "400ms" become NaN, which setTimeout also treats as zero.
 */
export function envNumber(raw: unknown, fallback: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw === null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}; got ${JSON.stringify(text)}`);
  }
  return value;
}

/**
 * Resolve the git directory for a root: `.git` as a directory, or a worktree's `gitdir:` file.
 *
 * The file is written by git but lives in a directory somebody else may have authored, and it can
 * name any directory at all. Pointing outside the watched root is not itself wrong — that is what
 * a worktree does, since git keeps the real directory under the main repository — so the caller
 * is what decides whether to follow it, by looking for a HEAD there before watching anything.
 * What is refused here is a line too long to be a path.
 */
export function gitDirFrom(root: string, dotGitIsDir: boolean, dotGitText: string | undefined, resolvePath: (base: string, p: string) => string): string | null {
  if (dotGitIsDir) return resolvePath(root, ".git");
  const m = /^gitdir:\s*(.+)$/m.exec(dotGitText ?? "");
  const named = m?.[1]?.trim();
  if (!named || named.length > MAX_PATH) return null;
  return resolvePath(root, named);
}

/**
 * Where an event is handed over — and the fact that this sensor is not waiting for the answer.
 *
 * The runtime runs a whole loop per event (world, significance, intent, a model call, permissions,
 * capabilities, the morph) before it answers, and this sensor held the connection open through all
 * of it for a result it never reads. `wait=0` gets an acknowledgement instead; the event is still
 * run, in the order this sensor sent it. The runtime answers the old way when nobody says this,
 * which is what the body wants and what every caller written before this did.
 */
export function ingestUrl(runtimeUrl: string): string {
  return `${runtimeUrl}/api/events?wait=0`;
}

/**
 * How many of this session's events the runtime has let go, read out of its acknowledgement.
 *
 * Since this sensor stopped waiting for the loop, every answer is a 202 whether the event ran or
 * was thrown away under load, so `res.ok` says nothing about either. The count is the one thing
 * that still comes back, and it is read strictly rather than trusted: the body of an answer is
 * outside data like any other, and a proxy's error page or an older runtime is not a count.
 *
 * This module takes no runtime dependencies on purpose - reviewing it is reviewing what can leave
 * the machine - so the check is spelled out here instead of being handed to a schema library.
 */
export function droppedFromAck(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const n = (body as { dropped?: unknown }).dropped;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * One line, the moment the count goes up, and silence otherwise.
 *
 * A count that went DOWN is a runtime that restarted, not events coming back, so it is followed
 * without a word rather than reported as a recovery.
 */
export function dropNotice(seen: number, reported: number | null): { seen: number; note: string | null } {
  if (reported === null) return { seen, note: null };
  if (reported <= seen) return { seen: reported, note: null };
  const now = reported - seen;
  return {
    seen: reported,
    note: `[particle-agent] the runtime let go of ${now} more of this session's events (${reported} in total): it is behind, and what they observed is gone`,
  };
}

/** One-line startup warning when the runtime is unreachable (sensing stays best-effort). */
export function healthWarning(runtimeUrl: string, reachable: boolean): string | null {
  return reachable ? null : `[particle-agent] runtime not reachable at ${runtimeUrl} — events are dropped until it is up (pnpm runtime)`;
}

/**
 * A queue that sends one thing at a time, in the order it was handed them. Transitions only mean
 * something in order — a recovery must never overtake the failure it recovers from — so a second
 * send waits for the first rather than racing it.
 *
 * When the far end is hung or slow the queue fills, and at the ceiling the NEWEST item is dropped
 * rather than the oldest: what is already queued is the earlier part of the story, and a story
 * with its beginning is worth more than one with its end.
 */
export function createSendQueue(
  post: (payload: unknown) => Promise<void>,
  options: { maxPending?: number; onError?: (err: unknown) => void } = {},
) {
  const maxPending = options.maxPending ?? 500;
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let dropped = 0;

  return {
    send(payload: unknown): Promise<void> {
      if (pending >= maxPending) {
        dropped += 1;
        return chain;
      }
      pending += 1;
      chain = chain.then(async () => {
        try {
          await post(payload);
        } catch (err) {
          options.onError?.(err); // best-effort: the far end being down is not our problem to solve
        } finally {
          pending -= 1;
        }
      });
      return chain;
    },
    /** How many sends are queued or in flight. */
    pending: () => pending,
    /** How many were dropped at the ceiling, for an honest indicator. */
    dropped: () => dropped,
  };
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

// ── the window in front → a shape ──

/**
 * Chromium-family programs, which this sensor says nothing about.
 *
 * The browser extension already reports what happens in a browser, by tab and by host. The same
 * fact arriving twice is the runtime counting it twice, and the copy this sensor could send is
 * the coarser one: one window title where the extension has the site the person is actually on.
 * Matched on the whole program name, since "chromedriver" and "operator-console" are not browsers.
 */
const BROWSER_APPS = new Set(["chrome", "msedge", "brave", "chromium", "vivaldi", "opera", "whale", "arc", "thorium"]);

/** What this sensor will say about the window in front: which program, and what the window is called. */
export type WindowShape = { app: string; window: string };

/**
 * One reading as the sensor prints it: the program name, a tab, then the window title.
 *
 * A title can hold a tab of its own, so only the FIRST one separates — splitting on every tab
 * would cut a title in half and report the half as a window.
 */
export function parseWindowLine(line: unknown): { app: string; title: string } | null {
  if (typeof line !== "string") return null;
  const at = line.indexOf("\t");
  if (at < 0) return null;
  return { app: line.slice(0, at), title: line.slice(at + 1) };
}

/**
 * A reading made fit to send, or nothing when there is nothing to say about it.
 *
 * Both names come from outside this process — a program names its own window, and a window title
 * is unbounded and may carry an escape sequence — so both go through identifier(), the same way
 * a branch name and a path do.
 */
export function windowShape(app: unknown, title: unknown): WindowShape | null {
  const name = identifier(app);
  if (!name) return null; // a window whose program has no name is not a window this can report
  if (BROWSER_APPS.has(name.toLowerCase().replace(/\.exe$/, ""))) return null;
  return { app: name, window: identifier(title) };
}

/**
 * Everything in a title that is not a letter or a digit. Measured on a real desktop: a terminal
 * running this repository alternated its title between two spinner characters twice a second, so
 * a sensor comparing titles letter for letter reported a window switch every half second, for as
 * long as the command ran. An editor does the same quieter, with a dot or an asterisk for unsaved
 * work. None of that is the person moving to another window.
 *
 * Digits are kept, so "(3) general" and "(11) general" read as a change although they are one
 * window: an unread count is the part of such a title that means something, and being wrong this
 * way costs one event rather than a stream of them. A title that is nothing but decoration — a
 * bare spinner — has nothing left to tell two readings apart, which is right: it is one window.
 */
const TITLE_DECORATION = /[^\p{L}\p{N}]+/gu;

function titleKey(title: string): string {
  return title.replace(TITLE_DECORATION, "").toLowerCase();
}

/** Whether two readings are the same window: the same program, and the same title under its decoration. */
export function sameWindow(a: WindowShape, b: WindowShape): boolean {
  return a.app === b.app && titleKey(a.window) === titleKey(b.window);
}

/**
 * Turns a stream of readings into the moments the window in front CHANGED — the same bargain the
 * OutputTracker makes with test output. A reading that is the window already reported says
 * nothing, however many times it arrives.
 *
 * A browser reading leaves the remembered window alone rather than clearing it: this sensor has
 * nothing to say about browsers at all, including that the person went to one, and re-reporting
 * the editor on the way back would be announcing a switch it is not allowed to have seen.
 */
export class WindowTracker {
  private current: WindowShape | null = null;

  feed(line: string): Signal | null {
    const read = parseWindowLine(line);
    if (!read) return null;
    const shape = windowShape(read.app, read.title);
    return shape ? this.feedShape(shape) : null;
  }

  /**
   * The same decision from a reading somebody already parsed.
   *
   * The screen layer rides on the same line stream and needs every reading, not only the ones
   * that are a change, so the caller parses once and both senses are handed the result.
   */
  feedShape(shape: WindowShape): Signal | null {
    if (this.current && sameWindow(this.current, shape)) return null;
    this.current = shape;
    return { type: "user.focused_window", source: "user", severity: "debug", payload: { ...shape } };
  }
}

// ── the screen layer: a picture of a listed app's window ──

/**
 * How many programs somebody may list for photographing.
 *
 * A ceiling rather than a preference. The point of this layer is the few windows the
 * accessibility interface cannot read, and a list long enough to cover a desktop is the
 * photograph-everything option `docs/CONSENT_V2.md` refuses, arrived at by another route. It also
 * keeps the agent's declared layers inside the sixteen a sensor may declare (MAX_SENSOR_LAYERS),
 * which the other four senses share.
 */
export const MAX_CAPTURE_APPS = 8;

/** Letters in any alphabet, digits, and the three characters a program name actually uses. */
const PROGRAM_NAME = /^[\p{L}\p{N}._\- ]+$/u;

/**
 * The programs somebody listed for photographing, or none.
 *
 * Nothing means none, which is this layer's whole default: with no list the sensor does not run,
 * no picture is taken and the agent behaves exactly as it did before. A name that is not a
 * program name is refused out loud rather than skipped — somebody who typed one meant it, and
 * quietly photographing a shorter list than they wrote is the worse answer. So is quietly
 * photographing a longer one: a name is matched against the program behind a window, so a path or
 * a wildcard in the list is a misunderstanding about what this layer takes, not a target.
 */
export function captureApps(raw: unknown, name = "DM_CAPTURE_APPS"): string[] {
  if (raw === undefined || raw === null) return [];
  const written = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  const apps: string[] = [];
  const seen = new Set<string>();
  for (const app of written) {
    if (app.length > MAX_NAME || !PROGRAM_NAME.test(app)) {
      throw new Error(`${name} lists programs by name — letters, digits, dots, dashes, underscores or spaces, at most ${MAX_NAME} characters; got ${JSON.stringify(app)}`);
    }
    // a program is matched by name without regard to case, so two spellings of one program are
    // one program, and declaring both would say the camera is pointed at two windows
    const key = app.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(app);
  }
  if (apps.length > MAX_CAPTURE_APPS) {
    throw new Error(`${name} names ${apps.length} programs; this layer photographs the few windows that cannot be read any other way, so it takes at most ${MAX_CAPTURE_APPS}`);
  }
  return apps;
}

/**
 * How this sensor declares the screen layer: one entry per app it may photograph.
 *
 * `screen` alone would say a camera is on without saying what it is pointed at, and which window
 * is being photographed is the part a person needs (docs/CONSENT_V2.md). The words for this live
 * with the body, which splits the app off the layer name.
 */
export function screenLayers(apps: readonly string[]): string[] {
  return apps.map((app) => `screen:${app}`);
}

/**
 * Which readings of the window in front lead to a picture.
 *
 * Two rules, both narrowing. A program nobody listed is never photographed, whatever is in front.
 * And a listed program is photographed at most once per interval: the window in front is read
 * every second, so without a floor an afternoon in a chat window would be an afternoon of
 * pictures of it. The interval is counted per program, and from the moment a picture is asked for
 * rather than finished, which is also what keeps two captures of one window from overlapping.
 */
export class CaptureSchedule {
  /** lower-cased program name → the spelling the person wrote, which is what gets photographed */
  private readonly listed = new Map<string, string>();
  private readonly lastClaimed = new Map<string, number>();

  constructor(apps: readonly string[], private readonly minIntervalMs: number) {
    for (const app of apps) this.listed.set(app.toLowerCase(), app);
  }

  /**
   * The listed program to photograph for this reading, or null — and a claim is remembered, so
   * the next reading inside the interval asks for nothing.
   */
  claim(app: unknown, now: number): string | null {
    if (typeof app !== "string") return null;
    const key = app.trim().toLowerCase();
    const wanted = this.listed.get(key);
    if (!wanted) return null;
    const last = this.lastClaimed.get(key);
    if (last !== undefined && now - last < this.minIntervalMs) return null;
    this.lastClaimed.set(key, now);
    return wanted;
  }
}

/** Whether the screen layer runs, and what to tell the person if it does not. */
export type ScreenSensorDecision = { run: boolean; note: string | null };

/**
 * The one sense that reads what is IN a window, so three things have to be true at once.
 *
 * Somebody has to list the apps, because this layer never photographs a window they did not name.
 * The camera has to be turned on separately with DM_CAPTURE, which is the second deliberate act
 * `docs/CONSENT_V2.md` asks of this layer and the switch the capture package already refuses
 * without. And the window reader has to be up, because what is photographed is the listed app the
 * person just switched into: turning that reader on from here instead would start sending the
 * title of every window they open, which is wider than the consent they gave.
 *
 * Listing nothing is silence, the way the other senses are silent when nobody asked for them.
 * Listing apps and getting no pictures is not: that is said once, to the person who asked.
 */
export function screenSensor(platform: string, captureOn: boolean, apps: readonly string[], windowsRunning: boolean): ScreenSensorDecision {
  if (apps.length === 0) return { run: false, note: null };
  if (platform !== "win32") {
    return { run: false, note: `[particle-agent] a window is photographed through the Windows API; nothing is photographed on ${platform}` };
  }
  if (!captureOn) {
    return { run: false, note: "[particle-agent] DM_CAPTURE_APPS names apps but the camera is off; set DM_CAPTURE=1 to let this layer photograph them" };
  }
  if (!windowsRunning) {
    return { run: false, note: "[particle-agent] the screen layer photographs the listed app you are in, so it needs the window reader; set DM_WATCH_WINDOWS=1" };
  }
  return { run: true, note: null };
}

// ── reading the picture: a separate switch, because a picture read is a picture sent ──

/** Whether a photographed window is handed to a model, and what to tell the person if it is not. */
export type ScreenReaderDecision = { run: boolean; note: string | null };

/**
 * Brains that read a picture without it going anywhere.
 *
 * The deterministic brain runs inside this process and answers without looking at a pixel, so a
 * reading it produced cost nothing off this machine — which is what `.env.example` and the agent
 * README promise for the no-key case. Every other brain the router can offer is reached over the
 * network.
 *
 * The id is spelled here rather than asked of the provider because the provider interface has no
 * word for where a brain runs, and this is the only place that needs to know: the one line a
 * person reads at the moment they turn reading on. A new brain that runs locally belongs in this
 * set, and leaving it out costs a sentence that is too careful rather than one that is untrue.
 */
const IN_PROCESS_BRAINS = new Set(["mock"]);

/**
 * How many taken-but-unread pictures are held while a model is answering about another.
 *
 * Two, because the window in front is read every second and a reading takes as long as a model
 * takes: a deeper queue would not catch up, it would read windows somebody left minutes ago and
 * report them as what they are doing now. A backlog of screens is worth less the older it gets,
 * which is the opposite of the transitions `createSendQueue` carries.
 */
export const MAX_PENDING_READS = 2;

/**
 * Pictures waiting for a model, one reading at a time, newest kept.
 *
 * Reading used to happen inside the capture lock, so the next picture of ANY app waited for a
 * model to answer about the last one — the camera stopped taking pictures because a model was
 * thinking. The lock was never there to protect the model: it was there so two readings of one
 * window could not race each other to the runtime and arrive in the wrong order. That is what
 * this keeps, and nothing else.
 *
 * At the ceiling the OLDEST frames go, and every one of them is counted: a sense that quietly
 * stops reporting is the one failure this layer cannot afford, since nobody is watching a
 * daemon's output waiting for a reading that is never coming.
 */
export function createReadQueue<T>(
  read: (item: T) => Promise<void>,
  options: { max?: number; onDrop?: (item: T, dropped: number) => void; onError?: (err: unknown) => void } = {},
) {
  const max = options.max ?? MAX_PENDING_READS;
  const waiting: T[] = [];
  let running = false;
  let dropped = 0;

  function pump(): void {
    if (running || waiting.length === 0) return;
    const next = waiting.shift() as T;
    running = true;
    // `read` may throw rather than reject - a synchronous failure before it ever returns a
    // promise. Left to escape, it would take `pump` down with it and leave the worker marked busy
    // with nobody reading, so every frame after it would queue behind work that had already
    // failed and this layer would stop for good without saying anything.
    void (async () => await read(next))()
      .catch((err: unknown) => options.onError?.(err))
      .finally(() => {
        running = false;
        pump();
      });
  }

  return {
    push(item: T): void {
      if (waiting.length >= max) {
        const oldest = waiting.shift() as T;
        dropped += 1;
        options.onDrop?.(oldest, dropped);
      }
      waiting.push(item);
      pump();
    },
    /** Frames taken and not yet read, including the one a model is looking at. */
    pending: () => waiting.length + (running ? 1 : 0),
    /** How many were taken and never read, for an honest count rather than a silence. */
    dropped: () => dropped,
  };
}

/**
 * Taking a picture and reading one are two things to agree to, not one.
 *
 * Until here a frame stayed on the disk it was written to. A model reads it by being handed the
 * pixels, and unless the model runs on this machine that is the moment they leave it — which is
 * exactly what `docs/CONSENT_V2.md` treats as its own decision. So it is its own switch, it is
 * off by default, and turning the camera on does not turn it on.
 *
 * It cannot run on its own either: with nothing being photographed there is nothing to read, and
 * somebody who set only this switch is told which other ones are missing rather than left
 * wondering why no reading ever appears.
 */
export function screenReader(readOn: boolean, screenRunning: boolean, brains: readonly string[]): ScreenReaderDecision {
  if (!readOn) return { run: false, note: null };
  if (!screenRunning) {
    return {
      run: false,
      note: "[particle-agent] DM_SCREEN_READ is on but nothing is being photographed; the screen layer also needs DM_CAPTURE=1, DM_CAPTURE_APPS and DM_WATCH_WINDOWS=1",
    };
  }
  if (brains.length === 0) {
    return { run: false, note: "[particle-agent] DM_SCREEN_READ is on but no brain in this process can be handed a picture; pictures stay on disk unread" };
  }
  const hosted = brains.filter((id) => !IN_PROCESS_BRAINS.has(id));
  const where =
    hosted.length === 0
      ? "Every brain here runs in this process and looks at no pixels, so no picture leaves this machine."
      : `${hosted.join(", ")} ${hosted.length === 1 ? "reads" : "read"} the pixels off this machine.`;
  return {
    run: true,
    note: `[particle-agent] DM_SCREEN_READ is on: every picture is handed to a model to read (brains here: ${brains.join(", ")}). ${where} Unset DM_SCREEN_READ and pictures stay on disk, unread.`,
  };
}

/** The window a reading is of, and the brain that read it. */
export type ReadSource = { app: string; window: string; path: string; providerId: string; modelId?: string };

/**
 * What the runtime is told about a window a model read.
 *
 * Flat on purpose: the belief keeps a payload's scalar fields and leaves anything nested behind,
 * so topics travel as one line rather than as a list that would arrive as nothing. What the
 * model wrote is held to the same length and the same characters as every other name this sensor
 * sends — it is the one payload here whose words were written by a model rather than observed,
 * and it is printed in a terminal like all the others.
 *
 * The pixels are not in it. What travels is the situation, which app, where the file is, and
 * which brain read it, so that the record says who saw the picture.
 */
export function screenReadPayload(reading: ScreenReading, source: ReadSource): Record<string, unknown> {
  const model = identifier(source.modelId);
  return {
    app: identifier(source.app),
    window: identifier(source.window),
    path: source.path,
    provider: identifier(source.providerId),
    ...(model ? { model } : {}),
    activity: reading.activity,
    summary: identifier(reading.summary),
    topics: identifier(reading.topics.join(", ")),
    needsAttention: reading.needsAttention,
    confidence: reading.confidence,
  };
}

/** Whether the active-window sensor runs, and what to tell the person if it does not. */
export type WindowSensorDecision = { run: boolean; note: string | null };

/**
 * The window in front is read through the Windows UI Automation API. Everywhere else this sense
 * is simply absent — the agent's other senses are untouched — and the only thing worth saying is
 * said to the person who asked for it, once.
 */
export function windowSensor(platform: string, requested: boolean): WindowSensorDecision {
  if (!requested) return { run: false, note: null };
  if (platform !== "win32") {
    return { run: false, note: `[particle-agent] the window in front is read through Windows UI Automation; nothing is sensed on ${platform}` };
  }
  return { run: true, note: null };
}

const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS = new Set(["", "0", "false", "no", "off"]);

/**
 * A switch somebody put in the environment.
 *
 * Nothing means off, the way an env file says nothing. A value that is present but says no means
 * off too: read as "anything non-empty is yes", DM_WATCH_WINDOWS=0 would start watching the
 * desktop — the same shape of mistake as reading an empty value as zero. A value that says
 * neither is refused at startup rather than guessed at.
 */
export function envFlag(raw: unknown, name: string): boolean {
  if (raw === undefined || raw === null) return false;
  const text = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  throw new Error(`${name} must be one of 1/true/yes/on or 0/false/no/off; got ${JSON.stringify(text)}`);
}

/**
 * The script that reads the window in front, once every interval, and prints the program name and
 * the window title.
 *
 * It is PowerShell because that is how this agent reaches UI Automation without taking a native
 * dependency — the agent has no runtime dependencies on purpose, since somebody runs it on their
 * own machine and what it can do should be readable in one file.
 *
 * The interval and the agent's own process id are the only things this process puts into a script
 * another program runs, so both are refused unless they are whole numbers. A string would be a way
 * into this machine.
 *
 * What the script may read is the whole privacy story of this sense: a window handle, the process
 * behind it, and the name the window gives itself. Not its contents, not its text patterns, not
 * the clipboard.
 */
export function windowScript(intervalMs: number, parentPid: number): string {
  for (const [label, value] of [["polling interval", intervalMs], ["parent process id", parentPid]] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new Error(`window ${label} must be a whole number; got ${JSON.stringify(value)}`);
    }
  }
  return [
    // the titles on this desktop are not ASCII; without this they arrive here as question marks
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "Add-Type -Namespace ParticleAgent -Name Window -MemberDefinition @\"",
    "[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "\"@",
    "while ($true) {",
    // this reader sees the whole desktop and nobody can see IT: when the agent is gone, so is it
    `  if (-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { break }`,
    "  $app = $null",
    "  $title = $null",
    "  try {",
    "    $handle = [ParticleAgent.Window]::GetForegroundWindow()",
    "    if ($handle -ne [IntPtr]::Zero) {",
    "      $element = [System.Windows.Automation.AutomationElement]::FromHandle($handle)",
    "      $owner = Get-Process -Id $element.Current.ProcessId -ErrorAction SilentlyContinue",
    "      if ($owner) { $app = $owner.ProcessName; $title = $element.Current.Name }",
    "    }",
    // a window that closed between the handle and the read is read next tick; a sensor that
    // cannot see something says nothing about it rather than stopping
    "  } catch { }",
    // outside that catch on purpose: a write that fails is the agent's end of the pipe gone,
    // and this process ending is the right answer to it
    "  if ($app) { Write-Output (\"{0}`t{1}\" -f $app, $title) }",
    `  Start-Sleep -Milliseconds ${intervalMs}`,
    "}",
  ].join("\n");
}
