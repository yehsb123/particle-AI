import type { CaptureConfig } from "./config";

/**
 * Which window to point at.
 *
 * `foreground` is the window somebody is actually in; `app` is a named program, which is the case
 * this package exists for — the accessibility window the UI Automation sensor cannot read is
 * usually not the one in front when you go looking for it.
 */
export type CaptureTarget = { kind: "foreground" } | { kind: "app"; app: string };

/** One picture, asked for. `path` is where the backend writes it. */
export type CaptureRequest = {
  target: CaptureTarget;
  path: string;
  /** How long the backend may take before it is given up on. Backends that cannot hang ignore it. */
  timeoutMs?: number;
};

/**
 * One picture, taken. The file is on disk at `path` and nothing here carries the pixels: a frame
 * travels as a filename. A caller that wants the pixels opens the file itself and answers for
 * doing so — the desktop agent's reading switch is the one place that does (docs/CONSENT_V2.md).
 */
export type CaptureFrame = {
  path: string;
  format: "png";
  width: number;
  height: number;
  bytes: number;
  /** The program the window belongs to, and the name the window gives itself. */
  app: string;
  window: string;
  capturedAt: string;
  backend: string;
};

export type CaptureResult = { ok: true; frame: CaptureFrame } | { ok: false; reason: string };

/**
 * A way of taking one picture of one window.
 *
 * One method on purpose. A backend that cannot run where it was asked to — the Windows one on
 * Linux, the OBS one with nothing listening — answers with a refusal rather than a thrown error,
 * because every caller already has to handle the picture not being there.
 */
export type CaptureBackend = {
  readonly name: string;
  capture(request: CaptureRequest): Promise<CaptureResult>;
};

/** The backends this process was handed, by name. */
export type CaptureRegistry = {
  names(): string[];
  get(name: string): CaptureBackend | null;
};

/**
 * Hold a set of backends.
 *
 * Handing them in is the whole licence boundary: this package links the Windows backend, and any
 * other one — the GPL OBS backend above all — only exists in a process whose own code imported it
 * and passed it here. Nothing in this package can reach a backend nobody handed in.
 */
export function createCaptureRegistry(backends: readonly CaptureBackend[]): CaptureRegistry {
  const byName = new Map<string, CaptureBackend>();
  for (const backend of backends) {
    if (byName.has(backend.name)) {
      throw new Error(`two capture backends are called ${JSON.stringify(backend.name)}; the choice between them has no answer`);
    }
    byName.set(backend.name, backend);
  }
  return {
    names: () => [...byName.keys()],
    get: (name) => byName.get(name) ?? null,
  };
}

export type CaptureBackendChoice = { ok: true; backend: CaptureBackend } | { ok: false; refused: string };

/**
 * Which backend takes this picture, or why none does.
 *
 * Off is checked first and means off: there is no backend, no fallback and no picture. A named
 * backend nobody handed in is refused by name rather than replaced with a working one, because a
 * fallback would take the picture through a path the person did not choose.
 */
export function chooseCaptureBackend(config: CaptureConfig, registry: CaptureRegistry): CaptureBackendChoice {
  if (!config.enabled) {
    return { ok: false, refused: "screen capture is off; set DM_CAPTURE=1 to turn it on" };
  }
  const backend = registry.get(config.backend);
  if (!backend) {
    const held = registry.names();
    const list = held.length ? held.join(", ") : "none";
    return {
      ok: false,
      refused: `DM_CAPTURE_BACKEND=${config.backend} was not handed to this process; backends it holds: ${list}`,
    };
  }
  return { ok: true, backend };
}

/** Choose a backend and take one picture with it, or report why there is none. */
export async function captureWith(
  config: CaptureConfig,
  registry: CaptureRegistry,
  request: CaptureRequest,
): Promise<CaptureResult> {
  const choice = chooseCaptureBackend(config, registry);
  if (!choice.ok) return { ok: false, reason: choice.refused };
  // spreading the request over the default would let `timeoutMs: undefined` through as no deadline
  return choice.backend.capture({ ...request, timeoutMs: request.timeoutMs ?? config.timeoutMs });
}
