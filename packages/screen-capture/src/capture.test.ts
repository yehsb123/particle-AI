import { describe, it, expect } from "vitest";
import { createCaptureRegistry, chooseCaptureBackend, captureWith } from "./capture";
import type { CaptureBackend, CaptureRequest, CaptureResult } from "./capture";
import { readCaptureConfig } from "./config";

/** A backend that records what it was asked for and hands back a frame. No mocking: this is the interface. */
function fakeBackend(name: string): CaptureBackend & { asked: CaptureRequest[] } {
  const asked: CaptureRequest[] = [];
  return {
    name,
    asked,
    async capture(request: CaptureRequest): Promise<CaptureResult> {
      asked.push(request);
      return {
        ok: true,
        frame: {
          path: request.path,
          format: "png",
          width: 800,
          height: 600,
          bytes: 1234,
          app: "Fake",
          window: "a window",
          capturedAt: "2026-10-16T00:00:00.000Z",
          backend: name,
        },
      };
    },
  };
}

const request: CaptureRequest = { target: { kind: "foreground" }, path: "C:/shots/one.png" };

describe("choosing what takes the picture", () => {
  it("refuses while capture is switched off, whatever is registered", () => {
    const registry = createCaptureRegistry([fakeBackend("windows")]);
    const choice = chooseCaptureBackend(readCaptureConfig({}), registry);
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.refused).toContain("DM_CAPTURE");
  });

  it("takes the backend that was asked for once capture is on", () => {
    const windows = fakeBackend("windows");
    const choice = chooseCaptureBackend(readCaptureConfig({ DM_CAPTURE: "1" }), createCaptureRegistry([windows]));
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.backend).toBe(windows);
  });

  /**
   * The point of the whole arrangement: the OBS backend is GPL and lives in its own package, so
   * naming it in the environment is not enough. Somebody has to hand it in. Until they do, asking
   * for it is refused with the reason, rather than quietly falling back to another backend — a
   * silent fallback would take a picture through a path nobody chose.
   */
  it("refuses a backend nobody handed in, and says which ones were", () => {
    const registry = createCaptureRegistry([fakeBackend("windows")]);
    const choice = chooseCaptureBackend(readCaptureConfig({ DM_CAPTURE: "1", DM_CAPTURE_BACKEND: "obs" }), registry);
    expect(choice.ok).toBe(false);
    if (!choice.ok) {
      expect(choice.refused).toContain("obs");
      expect(choice.refused).toContain("windows");
    }
  });

  it("takes a backend somebody did hand in", () => {
    const obs = fakeBackend("obs");
    const registry = createCaptureRegistry([fakeBackend("windows"), obs]);
    const choice = chooseCaptureBackend(readCaptureConfig({ DM_CAPTURE: "1", DM_CAPTURE_BACKEND: "obs" }), registry);
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.backend).toBe(obs);
  });

  it("refuses two backends under one name, since the choice between them has no answer", () => {
    expect(() => createCaptureRegistry([fakeBackend("obs"), fakeBackend("obs")])).toThrow(/obs/);
  });

  it("lists what it holds", () => {
    expect(createCaptureRegistry([fakeBackend("windows"), fakeBackend("obs")]).names()).toEqual(["windows", "obs"]);
  });
});

describe("taking the picture", () => {
  it("gives back the frame the chosen backend produced", async () => {
    const windows = fakeBackend("windows");
    const result = await captureWith(readCaptureConfig({ DM_CAPTURE: "on" }), createCaptureRegistry([windows]), request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame.backend).toBe("windows");
      expect(result.frame.path).toBe("C:/shots/one.png");
    }
    // a request that names no deadline gets the configured one, so no caller can leave it open
    expect(windows.asked).toEqual([{ ...request, timeoutMs: 15_000 }]);
  });

  it("lets a caller who named a deadline keep it", async () => {
    const windows = fakeBackend("windows");
    await captureWith(readCaptureConfig({ DM_CAPTURE: "on" }), createCaptureRegistry([windows]), { ...request, timeoutMs: 800 });
    expect(windows.asked[0]?.timeoutMs).toBe(800);
  });

  it("treats a deadline spelled out as nothing the same as one left out", async () => {
    const windows = fakeBackend("windows");
    await captureWith(readCaptureConfig({ DM_CAPTURE: "on" }), createCaptureRegistry([windows]), { ...request, timeoutMs: undefined });
    expect(windows.asked[0]?.timeoutMs).toBe(15_000);
  });

  it("gives back the refusal, and asks no backend, while capture is off", async () => {
    const windows = fakeBackend("windows");
    const result = await captureWith(readCaptureConfig({}), createCaptureRegistry([windows]), request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DM_CAPTURE");
    expect(windows.asked).toEqual([]);
  });
});
