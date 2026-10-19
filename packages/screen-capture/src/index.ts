/**
 * @particle/screen-capture — one window, one picture. MIT.
 *
 * This package is the MIT side of the capture boundary. Everything it links ships with Windows,
 * so adding it to a build adds no third-party licence. The OBS backend is GPL and lives in
 * `@particle/screen-capture-obs`: nothing here imports it, and a process only has it if its own
 * code imported that package and handed the backend to `createCaptureRegistry`. `boundary.test.ts`
 * holds this file and every file beside it to that.
 *
 * What this package does NOT do: it takes no picture by itself, reads none, and sends nothing
 * anywhere. A capture happens when somebody calls for one, with DM_CAPTURE on, and the picture
 * is written to their disk. The desktop agent is the one caller in this repository: with
 * DM_CAPTURE on and apps listed in DM_CAPTURE_APPS it photographs those apps' windows and
 * reports the file name, never the pixels. Whether anything then opens that file is a separate
 * decision taken somewhere else — the agent's DM_SCREEN_READ (docs/CONSENT_V2.md).
 */
export * from "./capture";
// the command line's own argument parsing, and with it the rule for what a picture is filed
// under when nobody named a file — which the desktop agent needs for the same reason
export * from "./cli";
export * from "./config";
export * from "./request";
export * from "./script";
export * from "./reading";
export * from "./windows";

import type { CaptureBackend, CaptureRegistry } from "./capture";
import { createCaptureRegistry } from "./capture";
import { windowsCaptureBackend } from "./windows";

/**
 * The backends a process has unless it says otherwise: the Windows one, plus whatever its own
 * code chose to hand in.
 *
 * Handing one in is the opt-in. There is no name, no environment variable and no setting that
 * makes a backend appear in a process that did not import it.
 */
export function defaultCaptureRegistry(extra: readonly CaptureBackend[] = []): CaptureRegistry {
  return createCaptureRegistry([windowsCaptureBackend(), ...extra]);
}
