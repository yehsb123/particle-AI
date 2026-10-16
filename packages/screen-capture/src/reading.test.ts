import { describe, it, expect } from "vitest";
import { parseCaptureReading } from "./reading";
import { MAX_IDENTIFIER } from "@particle/contracts";

/**
 * What the capture process printed, read back.
 *
 * The program name and the window title come from outside this machine's control — a program
 * names its own window — and they are written into a result somebody prints, logs and reads. They
 * go through the same trimming a branch name and a path do in the desktop agent: no control
 * characters, no newlines, and a bounded length.
 */
const OK = JSON.stringify({ ok: true, app: "Orca", window: "Orca", width: 1439, height: 851, path: "C:/shots/a.png" });

describe("reading back what the capture process reported", () => {
  it("reads a picture that was taken", () => {
    expect(parseCaptureReading(OK)).toEqual({
      ok: true,
      app: "Orca",
      window: "Orca",
      width: 1439,
      height: 851,
      path: "C:/shots/a.png",
    });
  });

  it("reads a refusal, with the reason", () => {
    const line = JSON.stringify({ ok: false, reason: "that window is minimised and has nothing to draw" });
    expect(parseCaptureReading(line)).toEqual({ ok: false, reason: "that window is minimised and has nothing to draw" });
  });

  it("finds the report among whatever else the process printed", () => {
    const noisy = ["WARNING: preparing modules for first use", OK, ""].join("\r\n");
    const read = parseCaptureReading(noisy);
    expect(read?.ok).toBe(true);
  });

  it("has nothing to say about output that is not a report", () => {
    for (const nothing of ["", "   ", "not json", "{}", '{"ok":"yes"}', JSON.stringify([1, 2]), undefined, null, 7]) {
      expect(parseCaptureReading(nothing), JSON.stringify(nothing) ?? "undefined").toBeNull();
    }
  });

  it("refuses a picture whose size is not a size", () => {
    // The rationale has not changed: a size that is not a size is refused. What changed is HOW.
    // It used to answer null, which a caller cannot tell from the process having said nothing at
    // all. A report that arrived and described something unusable now says so, because a window
    // one pixel across was being reported as a successful capture.
    for (const bad of [0, -1, 1.5, "800", null]) {
      const line = JSON.stringify({ ok: true, app: "A", window: "w", width: bad, height: 851, path: "a.png" });
      const read = parseCaptureReading(line);
      expect(read?.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a picture with no file behind it", () => {
    const line = JSON.stringify({ ok: true, app: "A", window: "w", width: 640, height: 480, path: "" });
    expect(parseCaptureReading(line)).toBeNull();
  });

  it("takes a window with no title, since plenty of windows have none", () => {
    const line = JSON.stringify({ ok: true, app: "A", window: "", width: 640, height: 480, path: "a.png" });
    expect(parseCaptureReading(line)).toEqual({ ok: true, app: "A", window: "", width: 640, height: 480, path: "a.png" });
  });

  it("refuses a picture whose program has no name, which is not a window anybody can point at", () => {
    const line = JSON.stringify({ ok: true, app: "", window: "w", width: 640, height: 480, path: "a.png" });
    expect(parseCaptureReading(line)).toBeNull();
  });

  it("strips what a terminal would read as an instruction out of a window title", () => {
    const line = JSON.stringify({ ok: true, app: "A", window: "\u001b[2Jwiped\u0007", width: 640, height: 480, path: "a.png" });
    const read = parseCaptureReading(line);
    expect(read).not.toBeNull();
    if (read?.ok) expect(read.window).toBe("[2Jwiped");
  });

  it("holds a window title to the length every other name here is held to", () => {
    const long = "t".repeat(MAX_IDENTIFIER + 40);
    const read = parseCaptureReading(JSON.stringify({ ok: true, app: "A", window: long, width: 640, height: 480, path: "a.png" }));
    expect(read?.ok).toBe(true);
    if (read?.ok) expect([...read.window].length).toBe(MAX_IDENTIFIER + 1);
  });

  it("says so when the process refused without saying why", () => {
    const read = parseCaptureReading(JSON.stringify({ ok: false }));
    expect(read).toEqual({ ok: false, reason: "the capture process refused without saying why" });
  });
});
