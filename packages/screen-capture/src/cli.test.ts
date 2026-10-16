import { describe, it, expect } from "vitest";
import { parseCaptureArgs, captureFileName } from "./cli";

/**
 * The command line is how somebody takes one picture by hand, which is how the backends in this
 * package were measured in the first place. Its argument reading is pure so that it is a tested
 * fact rather than something only Windows can check.
 */
describe("reading what was asked for on the command line", () => {
  it("points at a program by name", () => {
    const asked = parseCaptureArgs(["--app", "KakaoTalk"]);
    expect(asked.target).toEqual({ kind: "app", app: "KakaoTalk" });
  });

  it("points at the window in front when nothing else was named", () => {
    expect(parseCaptureArgs([]).target).toEqual({ kind: "foreground" });
    expect(parseCaptureArgs(["--foreground"]).target).toEqual({ kind: "foreground" });
  });

  it("takes the file to write when one was named", () => {
    expect(parseCaptureArgs(["--out", "C:/shots/a.png"]).out).toBe("C:/shots/a.png");
    expect(parseCaptureArgs([]).out).toBe("");
  });

  it("takes a backend by name, so the GPL one can be asked for without an env file", () => {
    expect(parseCaptureArgs(["--backend", "obs"]).backend).toBe("obs");
    expect(parseCaptureArgs([]).backend).toBe("");
  });

  it("refuses a flag that was given nothing to go with it", () => {
    for (const bad of [["--app"], ["--out"], ["--backend"], ["--app", "--out"]]) {
      expect(() => parseCaptureArgs(bad), bad.join(" ")).toThrow(/needs a value/);
    }
  });

  it("refuses a flag it does not know, rather than ignoring it", () => {
    expect(() => parseCaptureArgs(["--everything"])).toThrow(/--everything/);
  });

  it("is asked for help", () => {
    expect(parseCaptureArgs(["--help"]).help).toBe(true);
    expect(parseCaptureArgs([]).help).toBe(false);
  });
});

describe("the name a picture is filed under when nobody named one", () => {
  it("says what it is of and when it was taken", () => {
    const name = captureFileName({ kind: "app", app: "KakaoTalk" }, new Date("2026-10-16T04:05:06.000Z"));
    expect(name).toBe("particle-KakaoTalk-2026-10-16T04-05-06-000Z.png");
  });

  it("says so when it is the window in front", () => {
    expect(captureFileName({ kind: "foreground" }, new Date("2026-10-16T04:05:06.000Z"))).toContain("foreground");
  });

  /** A program name goes into a file name, and a file name is not a place to put a path. */
  it("keeps anything that could steer a path out of the name", () => {
    const name = captureFileName({ kind: "app", app: "a/b\\c d.e" }, new Date("2026-10-16T04:05:06.000Z"));
    expect(name).toBe("particle-a-b-c-d-e-2026-10-16T04-05-06-000Z.png");
  });
});
