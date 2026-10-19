import { describe, it, expect } from "vitest";
import { SENSOR_NAMES, SENSING_LAYERS } from "@particle/contracts";
import { describeSensor, describeLayer, sensesContent, contentExceptions } from "./sensing";
import { t } from "./i18n";

/**
 * The indicator is the runtime's honesty about what it can see: which sensors are reporting and
 * what each of them watches. A name with no words behind it would appear as a bare identifier in
 * the one place the person looks to find out what is being observed about them.
 */
describe("every sensor and layer has words", () => {
  it("names each sensor in both languages", () => {
    for (const sensor of SENSOR_NAMES) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`sensor_${sensor}`, lang), `${lang}:${sensor}`).not.toBe(`sensor_${sensor}`);
      }
      expect(t(`sensor_${sensor}`, "en"), sensor).not.toBe(t(`sensor_${sensor}`, "ko"));
    }
  });

  it("names each layer in both languages", () => {
    for (const layer of SENSING_LAYERS) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`layer_${layer}`, lang), `${lang}:${layer}`).not.toBe(`layer_${layer}`);
      }
    }
  });

  it("includes the name the runtime gives a sensor that did not give one", () => {
    // the world model records an unnamed sensor as "unknown"; it used to reach the screen as
    // the lookup key itself
    expect(SENSOR_NAMES).toContain("unknown");
    expect(describeSensor("unknown", "en")).not.toBe("unknown");
    expect(describeSensor("unknown", "ko")).not.toBe("unknown");
  });

  it("describes each of them rather than naming it", () => {
    for (const sensor of SENSOR_NAMES) expect(describeSensor(sensor, "ko"), sensor).not.toBe(sensor);
    for (const layer of SENSING_LAYERS) expect(describeLayer(layer, "ko"), layer).not.toBe(layer);
  });
});

describe("a name nobody wrote words for", () => {
  it("is still shown, readably", () => {
    // saying that some sensor is watching is worth more than saying nothing is
    expect(describeSensor("some_new_sensor", "en")).toBe("some new sensor");
    expect(describeLayer("clipboard_shape", "ko")).toBe("clipboard shape");
  });

  it("never leaves the lookup key on the screen", () => {
    for (const name of [...SENSOR_NAMES, "invented"]) {
      expect(describeSensor(name, "en"), name).not.toContain("sensor_");
      expect(describeSensor(name, "ko"), name).not.toContain("sensor_");
    }
    for (const name of [...SENSING_LAYERS, "invented"]) {
      expect(describeLayer(name, "en"), name).not.toContain("layer_");
      expect(describeLayer(name, "ko"), name).not.toContain("layer_");
    }
  });

  it("has nothing to say for nothing", () => {
    expect(describeSensor("", "en")).toBe("");
    expect(describeLayer("", "en")).toBe("");
  });

  it("is not confused by a name that belongs to every object", () => {
    for (const name of ["toString", "constructor"]) {
      expect(describeSensor(name, "en"), name).toBe(name);
      expect(describeLayer(name, "en"), name).toBe(name);
    }
  });
});

/**
 * The screen layer is the exception the rest of the indicator is measured against: every other
 * layer sends the shape of something, this one sends a picture of a window. The indicator is the
 * only place a person finds that out, so it has to say which window, and it must not go on
 * calling the whole line shape only (docs/CONSENT_V2.md).
 */
describe("the layer that reads a window rather than its shape", () => {
  it("is one of the layers a sensor may declare", () => {
    expect(SENSING_LAYERS as readonly string[]).toContain("screen");
  });

  it("names the app it is pointed at, not only itself", () => {
    for (const lang of ["en", "ko"] as const) {
      const line = describeLayer("screen:KakaoTalk", lang);
      expect(line, lang).toContain("KakaoTalk");
      expect(line, lang).not.toBe("screen:KakaoTalk");
      expect(line, lang).toContain(describeLayer("screen", lang));
    }
  });

  it("says the layer alone when no app came with it", () => {
    expect(describeLayer("screen:", "en")).toBe(describeLayer("screen", "en"));
    expect(describeLayer("screen:   ", "ko")).toBe(describeLayer("screen", "ko"));
  });

  it("leaves no lookup key on the screen when an app is named", () => {
    for (const lang of ["en", "ko"] as const) {
      expect(describeLayer("screen:KakaoTalk", lang)).not.toContain("layer_");
      expect(describeLayer("invented:Hancell", lang)).not.toContain("layer_");
    }
  });

  it("turns the caption on, whether or not an app came with it", () => {
    expect(sensesContent(["screen"])).toBe(true);
    expect(sensesContent(["windows", "screen:KakaoTalk"])).toBe(true);
  });

  it("leaves the caption alone for the layers that send shape", () => {
    expect(sensesContent([])).toBe(false);
    expect(sensesContent(["interactions", "network", "files", "git", "output", "windows"])).toBe(false);
    // a layer whose name merely begins the same way is a different layer
    expect(sensesContent(["screenshots", "screen_reader"])).toBe(false);
  });

  it("answers for a list a snapshot wrote, rather than taking the body down", () => {
    const junk = [null, 42, { screen: true }, undefined] as unknown as string[];
    expect(sensesContent(junk)).toBe(false);
    expect(sensesContent([...junk, "screen"] as string[])).toBe(true);
  });
});

/**
 * Two layers read content and they read different things. A caption that named one of them and
 * meant both would tell somebody running only the extension's page layer that a camera is on,
 * and somebody running only capture that their pages are being read — each of them a thing that
 * is not happening (docs/CONSENT_V2.md).
 */
describe("the layer that reads the page somebody is on", () => {
  it("is one of the layers a sensor may declare", () => {
    expect(SENSING_LAYERS as readonly string[]).toContain("page");
  });

  it("turns the caption on, the same as capture does", () => {
    expect(sensesContent(["tabs", "page"])).toBe(true);
  });

  it("names the exception that is actually running, and not the other one", () => {
    expect(contentExceptions(["tabs", "page"])).toEqual(["sensingPageExcepted"]);
    expect(contentExceptions(["windows", "screen:KakaoTalk"])).toEqual(["sensingScreenExcepted"]);
    expect(contentExceptions(["page", "screen"])).toEqual(["sensingScreenExcepted", "sensingPageExcepted"]);
    expect(contentExceptions(["interactions", "network"])).toEqual([]);
  });

  it("says something different for each exception, in both languages", () => {
    for (const key of contentExceptions(["page", "screen"])) {
      for (const lang of ["en", "ko"] as const) expect(t(key, lang), `${lang}:${key}`).not.toBe(key);
      expect(t(key, "en"), key).not.toBe(t(key, "ko"));
    }
    expect(t("sensingPageExcepted", "en")).not.toBe(t("sensingScreenExcepted", "en"));
    expect(t("sensingPageExcepted", "ko")).not.toBe(t("sensingScreenExcepted", "ko"));
  });

  it("is not confused by a layer whose name merely begins the same way", () => {
    expect(sensesContent(["pages", "page_rank"])).toBe(false);
  });
});

/**
 * A key nobody wrote words for falls back to the English, so Korean and English coming out
 * identical is how a missing phrase shows itself — asking whether the lookup returned the key is
 * not, because an English label IS its own key here.
 */
describe("both languages actually say something", () => {
  it("writes every layer twice", () => {
    for (const layer of SENSING_LAYERS) {
      expect(t(`layer_${layer}`, "en"), layer).not.toBe(t(`layer_${layer}`, "ko"));
    }
  });

  it("writes every sensor twice", () => {
    for (const sensor of SENSOR_NAMES) {
      expect(t(`sensor_${sensor}`, "en"), sensor).not.toBe(t(`sensor_${sensor}`, "ko"));
    }
  });

  it("says what the screen layer takes, where it lands, where it goes and how to stop it", () => {
    for (const key of ["screenConsentTitle", "screenConsentWhat", "screenConsentWhere", "screenConsentLeaves", "screenConsentOff"]) {
      expect(t(key, "en"), key).not.toBe(t(key, "ko"));
      expect(t(key, "en"), key).not.toBe(key);
      expect(t(key, "ko"), key).not.toBe(key);
    }
  });

  it("scopes the caption to the layers it is true of, and names the exception", () => {
    for (const lang of ["en", "ko"] as const) {
      expect(t("sensingShapeOnly", lang), lang).not.toBe("sensingShapeOnly");
      expect(t("sensingScreenExcepted", lang), lang).not.toBe("sensingScreenExcepted");
    }
    expect(t("sensingScreenExcepted", "en")).not.toBe(t("sensingScreenExcepted", "ko"));
  });
});
