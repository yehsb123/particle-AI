import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { CaptureBackend, CaptureRequest, CaptureResult } from "./capture";
import { captureEnv } from "./request";
import { captureScript } from "./script";
import { parseCaptureReading } from "./reading";

/** How long the capture process may take when the caller named no deadline of its own. */
const DEFAULT_TIMEOUT_MS = 15_000;

export type WindowsBackendOptions = {
  /** Which platform this is running on. An argument so the refusal can be a tested fact anywhere. */
  platform?: string;
};

/**
 * The capture backend that takes no third-party code: Windows' own user32 and System.Drawing,
 * through one short-lived PowerShell process.
 *
 * The script is passed as an encoded command rather than on stdin, for the reason the desktop
 * agent's window reader records: it is a multi-line script with a here-string in it, and
 * PowerShell reading that from stdin parses it as console input and exits without running it.
 *
 * The window to point at and the file to write go in the process's ENVIRONMENT, never into the
 * script, so no caller's text is ever part of a statement this machine runs.
 */
export function windowsCaptureBackend(options: WindowsBackendOptions = {}): CaptureBackend {
  const platform = options.platform ?? process.platform;
  return {
    name: "windows",
    capture(request: CaptureRequest): Promise<CaptureResult> {
      if (platform !== "win32") {
        return Promise.resolve({
          ok: false,
          reason: `this backend draws a window through the Windows API; there is nothing to draw with on ${platform}`,
        });
      }
      let env: Record<string, string>;
      try {
        env = captureEnv(request);
      } catch (err) {
        // a request this backend cannot carry out is an answer, not an exception thrown at a sensor
        return Promise.resolve({ ok: false, reason: (err as Error).message });
      }
      return run(env, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    },
  };
}

function run(env: Record<string, string>, timeoutMs: number): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(captureScript(), "utf16le").toString("base64");
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
        windowsHide: true,
        env: { ...process.env, ...env },
        // stderr is the CLIXML stream PowerShell writes when it is redirected: not readable as
        // text, and the report comes back on stdout either way
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      resolve({ ok: false, reason: `the capture process could not be started: ${(err as Error).message}` });
      return;
    }

    let printed = "";
    let settled = false;
    const finish = (result: CaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    // a capture process that never answers would leave its caller waiting forever, and this one
    // starts a .NET compile on first use — slow is ordinary here, silent is not
    const deadline = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, reason: `the capture process did not answer within ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { printed += chunk; });
    child.on("error", (err) => finish({ ok: false, reason: `the capture process failed to start: ${err.message}` }));
    child.on("close", (code) => {
      const read = parseCaptureReading(printed);
      if (!read) {
        finish({ ok: false, reason: `the capture process ended (${code}) without reporting anything` });
        return;
      }
      if (!read.ok) {
        finish({ ok: false, reason: read.reason });
        return;
      }
      let bytes: number;
      try {
        bytes = statSync(read.path).size;
      } catch (err) {
        // the process said it wrote a file and there is none: report that, never a picture
        finish({ ok: false, reason: `the capture process reported a picture that is not there: ${(err as Error).message}` });
        return;
      }
      finish({
        ok: true,
        frame: {
          path: read.path,
          format: "png",
          width: read.width,
          height: read.height,
          bytes,
          app: read.app,
          window: read.window,
          capturedAt: new Date().toISOString(),
          backend: "windows",
        },
      });
    });
  });
}
