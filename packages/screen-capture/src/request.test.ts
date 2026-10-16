import { describe, it, expect } from "vitest";
import { captureEnv, CAPTURE_ENV_NAMES } from "./request";
import { captureScript } from "./script";

/**
 * The window to point at and the file to write both come from whoever called this package, and
 * both end up in a process that runs a PowerShell script. They are handed over as environment
 * variables rather than written into the script, so there is no interpolation to escape and no
 * way for a name to become a statement — the same reason the agent's window script refuses
 * anything but whole numbers for the two values it does interpolate.
 *
 * What is checked here is the rest: a path this package would not be able to read back, and a
 * program name that is not one.
 */
describe("what the capture process is told", () => {
  it("names the window in front without naming a program", () => {
    expect(captureEnv({ target: { kind: "foreground" }, path: "C:/shots/a.png" })).toEqual({
      DM_CAPTURE_TARGET: "foreground",
      DM_CAPTURE_APP: "",
      DM_CAPTURE_PATH: "C:/shots/a.png",
    });
  });

  it("names a program when that is the window asked for", () => {
    const env = captureEnv({ target: { kind: "app", app: "KakaoTalk" }, path: "/tmp/a.png" });
    expect(env.DM_CAPTURE_TARGET).toBe("app");
    expect(env.DM_CAPTURE_APP).toBe("KakaoTalk");
  });

  it("trims the names around the edges, the way an env file is typed", () => {
    const env = captureEnv({ target: { kind: "app", app: "  KakaoTalk " }, path: "  /tmp/a.png  " });
    expect(env.DM_CAPTURE_APP).toBe("KakaoTalk");
    expect(env.DM_CAPTURE_PATH).toBe("/tmp/a.png");
  });

  it("refuses a program name that is not a program name", () => {
    for (const bad of ["", "   ", "Kakao\u0000Talk", "Kakao\nTalk", "a".repeat(121), "rm -rf /; Kakao"]) {
      expect(() => captureEnv({ target: { kind: "app", app: bad }, path: "/tmp/a.png" }), JSON.stringify(bad)).toThrow(/DM_CAPTURE_APP/);
    }
  });

  it("takes a program name in somebody's own alphabet", () => {
    expect(captureEnv({ target: { kind: "app", app: "카카오톡" }, path: "/tmp/a.png" }).DM_CAPTURE_APP).toBe("카카오톡");
  });

  it("refuses a path it could not read back", () => {
    for (const bad of ["", "   ", "/tmp/a\npng", "/tmp/a.png\u0007", "x".repeat(4_097) + ".png"]) {
      expect(() => captureEnv({ target: { kind: "foreground" }, path: bad }), JSON.stringify(bad.slice(0, 20))).toThrow(/DM_CAPTURE_PATH/);
    }
  });

  /** This package writes PNG and nothing else; a name that promises another format would lie. */
  it("refuses a file that does not say png", () => {
    expect(() => captureEnv({ target: { kind: "foreground" }, path: "/tmp/a.jpg" })).toThrow(/png/i);
    expect(captureEnv({ target: { kind: "foreground" }, path: "/tmp/a.PNG" }).DM_CAPTURE_PATH).toBe("/tmp/a.PNG");
  });
});

describe("the script and the variables it is given", () => {
  /**
   * The two halves have to agree by name. Renaming one of these in one place and not the other
   * would leave a capture process reading an empty variable and reporting that it found no such
   * window — a wrong answer that looks like an ordinary one.
   */
  it("agree on every name", () => {
    const env = captureEnv({ target: { kind: "app", app: "KakaoTalk" }, path: "/tmp/a.png" });
    expect(Object.keys(env).sort()).toEqual([...CAPTURE_ENV_NAMES].sort());
    const script = captureScript();
    for (const name of CAPTURE_ENV_NAMES) expect(script, name).toContain(`$env:${name}`);
  });

  /** A script that interpolated the caller's strings would be a way into this machine. */
  it("carries none of the caller's text", () => {
    const script = captureScript();
    expect(script).not.toContain("KakaoTalk");
    expect(script).not.toContain("${");
  });
});
