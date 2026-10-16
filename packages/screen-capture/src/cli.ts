import type { CaptureTarget } from "./capture";

export type CaptureArgs = { target: CaptureTarget; out: string; backend: string; help: boolean };

export const CAPTURE_USAGE = [
  "particle-capture — take one picture of one window and write it to a png.",
  "",
  "  --app <name>        the program whose window to draw (its process name, e.g. KakaoTalk)",
  "  --foreground        the window in front (the default)",
  "  --out <file.png>    where to write it (default: DM_CAPTURE_DIR, or the temp directory)",
  "  --backend <name>    which backend to use (default: DM_CAPTURE_BACKEND, or windows)",
  "  --help              this",
  "",
  "Capture is off until DM_CAPTURE=1. The obs backend is GPL and lives in its own package;",
  "it has to be handed to defaultCaptureRegistry by code that imported that package.",
].join("\n");

/**
 * What was asked for on the command line.
 *
 * An unknown flag is refused rather than ignored: somebody who typed one meant it, and quietly
 * taking a different picture from the one they asked for is the worse answer.
 */
export function parseCaptureArgs(argv: readonly string[]): CaptureArgs {
  let target: CaptureTarget = { kind: "foreground" };
  let out = "";
  let backend = "";
  let help = false;
  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--app":
        target = { kind: "app", app: value("--app", argv[i + 1]) };
        i += 1;
        break;
      case "--foreground":
        target = { kind: "foreground" };
        break;
      case "--out":
        out = value("--out", argv[i + 1]);
        i += 1;
        break;
      case "--backend":
        backend = value("--backend", argv[i + 1]);
        i += 1;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`unknown option ${JSON.stringify(flag)}; try --help`);
    }
  }
  return { target, out, backend, help };
}

/** Everything a file name is not. A program names its own window; a file name is not a path. */
const NOT_A_FILE_NAME = /[^\p{L}\p{N}]+/gu;

/** What a picture is filed under when nobody named a file: what it is of, and when it was taken. */
export function captureFileName(target: CaptureTarget, now: Date): string {
  const of = target.kind === "app" ? target.app : "foreground";
  const when = now.toISOString().replace(/[:.]/g, "-");
  return `particle-${of.replace(NOT_A_FILE_NAME, "-")}-${when}.png`;
}
