/**
 * Particle AI desktop agent — what somebody asked this machine to sense, and which senses run.
 *
 * Every sense here is off until an environment variable turns it on, and a value that says
 * neither yes nor no is refused at startup rather than guessed at. Nothing here sends anything:
 * these answers decide whether a sensor runs at all, and what the person is told when one they
 * asked for cannot.
 *
 * Like the rest of the agent this module takes no dependency on the monorepo on purpose — it
 * carries its own readers rather than sharing the runtime's, the way it carries its own MAX_NAME.
 */
import { MAX_NAME } from "./names";

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
