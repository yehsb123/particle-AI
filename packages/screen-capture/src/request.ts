import { MAX_IDENTIFIER } from "@particle/contracts";
import type { CaptureRequest } from "./capture";

/**
 * The variables the capture process is given.
 *
 * Handing the window and the file over this way, rather than writing them into the script, is
 * what keeps a program name from becoming a statement: there is no interpolation to escape. The
 * script reads these three by name, and `request.test.ts` holds the two halves to the same names.
 */
export const CAPTURE_ENV_NAMES = ["DM_CAPTURE_TARGET", "DM_CAPTURE_APP", "DM_CAPTURE_PATH"] as const;

/** How long a path this package will write. Every operating system stops well before this. */
export const MAX_CAPTURE_PATH = 4_096;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;
/** Letters in any alphabet, digits, and the three characters a program name actually uses. */
const PROGRAM_NAME = /^[\p{L}\p{N}._\- ]+$/u;

/**
 * Turn one request into the environment the capture process runs with, or refuse it.
 *
 * Refused rather than trimmed: a program name cut to length is a different program, and a path
 * this package cannot read back is a picture nobody can find.
 */
export function captureEnv(request: CaptureRequest): Record<string, string> {
  const path = request.path.trim();
  if (!path || path.length > MAX_CAPTURE_PATH || CONTROL_CHARACTER.test(path)) {
    throw new Error(`DM_CAPTURE_PATH must be a path of at most ${MAX_CAPTURE_PATH} characters and no control characters`);
  }
  if (!/\.png$/i.test(path)) {
    throw new Error(`DM_CAPTURE_PATH must end in .png; this backend writes png and nothing else, got ${JSON.stringify(path)}`);
  }
  const app = request.target.kind === "app" ? request.target.app.trim() : "";
  if (request.target.kind === "app" && (!app || app.length > MAX_IDENTIFIER || !PROGRAM_NAME.test(app))) {
    throw new Error(`DM_CAPTURE_APP must be a program name of at most ${MAX_IDENTIFIER} letters, digits, dots, dashes, underscores or spaces; got ${JSON.stringify(app)}`);
  }
  return { DM_CAPTURE_TARGET: request.target.kind, DM_CAPTURE_APP: app, DM_CAPTURE_PATH: path };
}
