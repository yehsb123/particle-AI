import { MAX_IDENTIFIER } from "@particle/contracts";

/** What the capture process said it did, after this package has made it fit to carry. */
export type CaptureReading =
  | { ok: true; app: string; window: string; width: number; height: number; path: string }
  | { ok: false; reason: string };

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * A name this machine observed, made fit to carry and to print.
 *
 * The same rule the desktop agent applies to a branch name, a path and a window title: a program
 * names its own window, nothing bounds what it may put there, and the name ends up in a result
 * somebody reads in a terminal — where an escape sequence is an instruction rather than a name.
 */
function shortName(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE, " ").trim();
  return clean.length > MAX_IDENTIFIER ? `${clean.slice(0, MAX_IDENTIFIER)}…` : clean;
}

/**
 * How small a side may be and still be a window somebody works in.
 *
 * Measured, and the reason this floor exists: KakaoTalk keeps nine visible windows. The two a
 * person uses were minimised, and the seven left were internal, sized 0x0 and 1x1. The biggest
 * of those is 1x1, so the search picked it, drew it, and reported a successful capture of a
 * hundred and twenty byte file. A caller cannot tell that from a real picture.
 */
export const MIN_WINDOW_SIDE = 32;

function side(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_WINDOW_SIDE ? value : null;
}

/**
 * Read the capture process's report out of whatever it printed.
 *
 * It prints one JSON line, but it is a PowerShell process and PowerShell says things of its own
 * on first use, so the report is looked for among the lines rather than assumed to be all of
 * them. Nothing readable means null: a caller that cannot tell a report from silence would call
 * silence a success.
 */
export function parseCaptureReading(text: unknown): CaptureReading | null {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const report = parsed as Record<string, unknown>;
    if (report.ok === false) {
      return { ok: false, reason: shortName(report.reason) || "the capture process refused without saying why" };
    }
    if (report.ok !== true) continue;
    const width = side(report.width);
    const height = side(report.height);
    const app = shortName(report.app);
    const path = typeof report.path === "string" ? report.path.trim() : "";
    // a picture with no size, no file or no program behind it is not a picture anybody can use
    if (!app || !path) return null;
    if (width === null || height === null) {
      return { ok: false, reason: "that window is too small to be one somebody works in" };
    }
    return { ok: true, app, window: shortName(report.window), width, height, path };
  }
  return null;
}
