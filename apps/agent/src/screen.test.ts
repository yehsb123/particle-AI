import { describe, it, expect } from "vitest";
import { KNOWN_EVENT_TYPES, MAX_SENSOR_LAYERS, SENSING_LAYERS } from "@particle/contracts";
import {
  captureApps,
  CaptureSchedule,
  MAX_CAPTURE_APPS,
  MAX_NAME,
  screenLayers,
  screenSensor,
} from "./shape";

/**
 * The screen layer is the one sense that reads what is IN a window rather than the shape of one,
 * so every rule that keeps it narrow is a rule worth a test: it is off until somebody lists apps,
 * it photographs nothing that is not on their list, and it says which apps it may photograph.
 *
 * All of it is pure on purpose. A picture can only be taken on Windows; whether this sensor is
 * OFF has to be a fact on the Linux machine CI runs on too.
 */
describe("the apps somebody listed for photographing", () => {
  it("are none until somebody lists them", () => {
    for (const nothing of [undefined, null, "", "   ", ",", " , , "]) {
      expect(captureApps(nothing), JSON.stringify(nothing) ?? "undefined").toEqual([]);
    }
  });

  it("are the programs named, trimmed, in the order they were written", () => {
    expect(captureApps("KakaoTalk, Excel ,Figma")).toEqual(["KakaoTalk", "Excel", "Figma"]);
  });

  it("name one program once, however many spellings of it were written", () => {
    expect(captureApps("KakaoTalk,kakaotalk,KAKAOTALK")).toEqual(["KakaoTalk"]);
  });

  it("refuse what is not a program name, rather than photographing something else", () => {
    // a path, a wildcard and an escape sequence are not programs; a name cut to length is a
    // different program, so the whole list is refused rather than trimmed
    for (const bad of ["C:/Windows/notepad.exe", "Kakao*", "Kakao\u001bTalk", "Kakao;Talk", "a".repeat(MAX_NAME + 1)]) {
      expect(() => captureApps(bad), bad).toThrow(/DM_CAPTURE_APPS/);
    }
  });

  it("refuse a list long enough to be the whole desktop", () => {
    const many = Array.from({ length: MAX_CAPTURE_APPS + 1 }, (_, i) => `App${i}`).join(",");
    expect(() => captureApps(many)).toThrow(/DM_CAPTURE_APPS/);
    const most = Array.from({ length: MAX_CAPTURE_APPS }, (_, i) => `App${i}`).join(",");
    expect(captureApps(most)).toHaveLength(MAX_CAPTURE_APPS);
  });
});

describe("what the screen layer declares", () => {
  it("names each app it may photograph, so the indicator says which window", () => {
    expect(screenLayers(["KakaoTalk", "Excel"])).toEqual(["screen:KakaoTalk", "screen:Excel"]);
  });

  it("declares a layer the shared vocabulary knows", () => {
    for (const layer of screenLayers(["KakaoTalk"])) {
      expect(SENSING_LAYERS as readonly string[]).toContain(layer.slice(0, layer.indexOf(":")));
    }
  });

  it("leaves room for the agent's other senses inside what a sensor may declare", () => {
    const everything = ["files", "git", "output", "windows", ...screenLayers(captureApps(Array.from({ length: MAX_CAPTURE_APPS }, (_, i) => `App${i}`).join(",")))];
    expect(everything.length).toBeLessThanOrEqual(MAX_SENSOR_LAYERS);
  });
});

describe("when a reading leads to a picture", () => {
  it("never photographs a program nobody listed", () => {
    const schedule = new CaptureSchedule(["KakaoTalk"], 60_000);
    expect(schedule.claim("Excel", 1_000)).toBeNull();
    expect(schedule.claim("", 1_000)).toBeNull();
    expect(schedule.claim(undefined, 1_000)).toBeNull();
  });

  it("photographs a listed program under the spelling the person listed", () => {
    const schedule = new CaptureSchedule(["KakaoTalk"], 60_000);
    expect(schedule.claim("kakaotalk", 1_000)).toBe("KakaoTalk");
  });

  it("takes one picture per interval, however many readings arrive", () => {
    // the window in front is read every second; without a floor, sitting in a chat window would
    // write a picture of it every second
    const schedule = new CaptureSchedule(["KakaoTalk"], 60_000);
    expect(schedule.claim("KakaoTalk", 1_000)).toBe("KakaoTalk");
    expect(schedule.claim("KakaoTalk", 2_000)).toBeNull();
    expect(schedule.claim("KakaoTalk", 60_999)).toBeNull();
    expect(schedule.claim("KakaoTalk", 61_000)).toBe("KakaoTalk");
  });

  it("counts the interval per program, so one app does not hold up another", () => {
    const schedule = new CaptureSchedule(["KakaoTalk", "Excel"], 60_000);
    expect(schedule.claim("KakaoTalk", 1_000)).toBe("KakaoTalk");
    expect(schedule.claim("Excel", 1_100)).toBe("Excel");
    expect(schedule.claim("KakaoTalk", 1_200)).toBeNull();
  });
});

describe("whether the screen layer runs at all", () => {
  const apps = ["KakaoTalk"];

  it("is off, silently, when nobody listed an app", () => {
    expect(screenSensor("win32", true, [], true)).toEqual({ run: false, note: null });
  });

  it("is off where there is nothing to photograph with, and says so once", () => {
    const decision = screenSensor("linux", true, apps, false);
    expect(decision.run).toBe(false);
    expect(decision.note).toContain("linux");
  });

  it("is off until the camera itself is turned on, and names the switch", () => {
    const decision = screenSensor("win32", false, apps, true);
    expect(decision.run).toBe(false);
    expect(decision.note).toContain("DM_CAPTURE");
  });

  it("is off without the window reader it rides on, and names that switch", () => {
    const decision = screenSensor("win32", true, apps, false);
    expect(decision.run).toBe(false);
    expect(decision.note).toContain("DM_WATCH_WINDOWS");
  });

  it("runs when the apps are listed, the camera is on and the window reader is up", () => {
    expect(screenSensor("win32", true, apps, true)).toEqual({ run: true, note: null });
  });
});

describe("what the screen layer reports", () => {
  it("reports a type the runtime knows", () => {
    expect(KNOWN_EVENT_TYPES as readonly string[]).toContain("sensor.captured_window");
  });
});
