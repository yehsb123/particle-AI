import { envNumber } from "@particle/contracts";

/**
 * What this package reads from the environment, and nothing else.
 *
 * `dir` empty means "no directory was named" — the caller decides what that falls back to, since
 * this module reaches no file system.
 */
export type CaptureConfig = {
  enabled: boolean;
  backend: string;
  dir: string;
  timeoutMs: number;
};

/** The backend that takes no GPL code: Windows' own API, through this package. */
export const DEFAULT_CAPTURE_BACKEND = "windows";

const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS = new Set(["", "0", "false", "no", "off"]);

/**
 * A switch somebody put in the environment.
 *
 * The same reader the desktop agent uses (envFlag in `apps/agent/src/shape.ts`), kept here rather
 * than shared because that agent is deliberately dependency-free and this package is not going to
 * reach into an app for it. Nothing means off, the way an env file says nothing; a value that is
 * present but says no means off too, because read as "anything non-empty is yes" `DM_CAPTURE=0`
 * would turn the camera on; a value that says neither is refused rather than guessed at.
 */
export function envFlag(raw: unknown, name: string): boolean {
  if (raw === undefined || raw === null) return false;
  const text = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  throw new Error(`${name} must be one of 1/true/yes/on or 0/false/no/off; got ${JSON.stringify(text)}`);
}

/**
 * Read the capture settings out of an environment.
 *
 * Pure on purpose: taking the environment as an argument is what lets the off state be a tested
 * fact rather than a claim, on every operating system, including the Linux machine CI runs on.
 */
export function readCaptureConfig(env: Record<string, string | undefined>): CaptureConfig {
  return {
    enabled: envFlag(env.DM_CAPTURE, "DM_CAPTURE"),
    backend: (env.DM_CAPTURE_BACKEND ?? "").trim().toLowerCase() || DEFAULT_CAPTURE_BACKEND,
    dir: (env.DM_CAPTURE_DIR ?? "").trim(),
    // a capture allowed no time never finishes; one allowed an hour is a process nobody noticed hang
    timeoutMs: envNumber(env.DM_CAPTURE_TIMEOUT_MS, 15_000, "DM_CAPTURE_TIMEOUT_MS", 100, 600_000),
  };
}
