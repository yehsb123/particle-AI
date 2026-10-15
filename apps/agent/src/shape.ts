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
    if (!shape) return null;
    if (this.current && sameWindow(this.current, shape)) return null;
    this.current = shape;
    return { type: "user.focused_window", source: "user", severity: "debug", payload: { ...shape } };
  }
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
