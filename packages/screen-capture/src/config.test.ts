import { describe, it, expect } from "vitest";
import { readCaptureConfig, DEFAULT_CAPTURE_BACKEND } from "./config";

/**
 * Capture is the widest thing this repository can do: a picture of a window holds whatever was on
 * the screen, including the parts the shape-only sensors are built never to read. So the question
 * this file pins down is not "how is it configured" but "is it off".
 *
 * An empty environment has to mean off, and a value that says off has to mean off too — the same
 * mistake envFlag was written for: read as "anything non-empty is yes", DM_CAPTURE=0 would turn
 * the camera on.
 */
describe("the capture configuration", () => {
  it("is off when nobody asked for it", () => {
    expect(readCaptureConfig({}).enabled).toBe(false);
    expect(readCaptureConfig({ DM_CAPTURE: "" }).enabled).toBe(false);
    expect(readCaptureConfig({ DM_CAPTURE: "   " }).enabled).toBe(false);
  });

  it("is off when somebody said no", () => {
    for (const no of ["0", "false", "no", "off", "OFF"]) {
      expect(readCaptureConfig({ DM_CAPTURE: no }).enabled, no).toBe(false);
    }
  });

  it("is on only when somebody said yes", () => {
    for (const yes of ["1", "true", "yes", "on", "YES"]) {
      expect(readCaptureConfig({ DM_CAPTURE: yes }).enabled, yes).toBe(true);
    }
  });

  it("refuses a switch that says neither, rather than guessing", () => {
    expect(() => readCaptureConfig({ DM_CAPTURE: "maybe" })).toThrow(/DM_CAPTURE/);
  });

  it("takes the Windows backend unless another one is named", () => {
    expect(readCaptureConfig({}).backend).toBe(DEFAULT_CAPTURE_BACKEND);
    expect(DEFAULT_CAPTURE_BACKEND).toBe("windows");
    expect(readCaptureConfig({ DM_CAPTURE_BACKEND: " OBS " }).backend).toBe("obs");
  });

  it("has no directory of its own until somebody names one", () => {
    expect(readCaptureConfig({}).dir).toBe("");
    expect(readCaptureConfig({ DM_CAPTURE_DIR: " C:/shots " }).dir).toBe("C:/shots");
  });

  it("reads the timeout the way every other number here is read", () => {
    expect(readCaptureConfig({}).timeoutMs).toBe(15_000);
    expect(readCaptureConfig({ DM_CAPTURE_TIMEOUT_MS: "" }).timeoutMs).toBe(15_000);
    expect(readCaptureConfig({ DM_CAPTURE_TIMEOUT_MS: "3000" }).timeoutMs).toBe(3_000);
    // a capture that is allowed zero time never finishes, and one allowed a day is a hung process
    expect(() => readCaptureConfig({ DM_CAPTURE_TIMEOUT_MS: "0" })).toThrow(/DM_CAPTURE_TIMEOUT_MS/);
    expect(() => readCaptureConfig({ DM_CAPTURE_TIMEOUT_MS: "15s" })).toThrow(/DM_CAPTURE_TIMEOUT_MS/);
  });
});
