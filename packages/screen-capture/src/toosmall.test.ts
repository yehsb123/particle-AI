import { describe, it, expect } from "vitest";
import { parseCaptureReading, MIN_WINDOW_SIDE } from "./reading";
import { captureScript } from "./script";

/**
 * A program keeps windows a person never sees. KakaoTalk keeps nine visible ones: the two
 * somebody actually uses, and seven internal ones sized 0x0 and 1x1.
 *
 * Measured on a real machine before this existed. The two real windows were minimised, so the
 * search skipped them, and the biggest of what was left was one pixel across. It drew that,
 * wrote a hundred and twenty byte file, and reported a successful capture. A caller receiving
 * that cannot tell it from a picture of a window.
 *
 * Two places now refuse it. The search does not offer a window too small to be one, and the
 * reader does not accept a report of one. Either alone would do; both because the script runs
 * outside this process and a future script is not bound by this one.
 */
describe("a window too small to be a window", () => {
  it("is not read as a successful capture", () => {
    const reading = parseCaptureReading(
      JSON.stringify({ ok: true, app: "KakaoTalk", window: "G", width: 1, height: 1, path: "C:/t/x.png" }),
    );
    expect(reading?.ok).toBe(false);
  });

  it("says why, rather than looking like silence", () => {
    // null would mean the process said nothing readable, which is a different thing from a
    // report that arrived and described something unusable
    const reading = parseCaptureReading(
      JSON.stringify({ ok: true, app: "KakaoTalk", window: "G", width: 1, height: 1, path: "C:/t/x.png" }),
    );
    expect(reading).not.toBeNull();
    if (reading?.ok === false) expect(reading.reason.length).toBeGreaterThan(0);
  });

  it("is refused on either side, not only one", () => {
    for (const size of [0, 1, 8, MIN_WINDOW_SIDE - 1]) {
      const wide = parseCaptureReading(
        JSON.stringify({ ok: true, app: "a", window: "w", width: 800, height: size, path: "C:/t/x.png" }),
      );
      const tall = parseCaptureReading(
        JSON.stringify({ ok: true, app: "a", window: "w", width: size, height: 800, path: "C:/t/x.png" }),
      );
      expect(wide?.ok, "height " + size).toBe(false);
      expect(tall?.ok, "width " + size).toBe(false);
    }
  });

  it("leaves a real window alone", () => {
    // the sizes this machine actually produced: a restored KakaoTalk and a Chrome window
    for (const [w, h] of [[784, 527], [1453, 865], [MIN_WINDOW_SIDE, MIN_WINDOW_SIDE]]) {
      const reading = parseCaptureReading(
        JSON.stringify({ ok: true, app: "a", window: "w", width: w, height: h, path: "C:/t/x.png" }),
      );
      expect(reading?.ok, w + "x" + h).toBe(true);
    }
  });
});

describe("the script that picks the window", () => {
  it("does not offer a window too small to be one", () => {
    const script = captureScript();
    expect(script).toContain("-ge 32");
  });

  it("says a program may be minimised rather than that it has no window", () => {
    // the old wording said no visible window belongs to that program, which was untrue: nine
    // belonged to it, and the ones a person uses were minimised
    expect(captureScript()).toContain("minimised");
  });
});
