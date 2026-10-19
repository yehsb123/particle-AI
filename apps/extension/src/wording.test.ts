import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KO } from "./wording";
import { DEFAULT_CONSENT } from "./shape";

/**
 * The options page IS the consent, so a phrase that reaches only half the readers is a phrase
 * half of them never agreed to. The page carries the English; this file carries the Korean. A
 * missing Korean entry falls back to the English, so "the two are the same" is how a gap shows
 * itself — asking whether a lookup returned its own key would not show it at all.
 */
const HTML = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../public/options.html"),
  "utf8",
);

/** The English of a `data-i18n` slot is the markup inside the element that carries it. */
function englishFor(key: string): string {
  const open = HTML.indexOf(`data-i18n="${key}"`);
  if (open < 0) return "";
  const start = HTML.indexOf(">", open) + 1;
  return HTML.slice(start, HTML.indexOf("<", start)).trim();
}

function keysOnThePage(): string[] {
  return [...HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!);
}

describe("the consent page reads in both languages", () => {
  it("has a Korean phrase for every slot the page marks", () => {
    expect(keysOnThePage().filter((k) => !Object.hasOwn(KO, k))).toEqual([]);
  });

  it("says something different in Korean, rather than the English twice", () => {
    for (const key of keysOnThePage()) {
      expect(KO[key], key).not.toBe(englishFor(key));
    }
  });
});

/**
 * The page layer reads the page somebody is on, which is more than the rest of this extension
 * does. The options page is where that is agreed to, so a layer that can be switched on without
 * a switch and words of its own on this page is a layer nobody consented to.
 */
describe("every layer this sensor can be switched on", () => {
  it("has a switch on the consent page, and words in both languages beside it", () => {
    for (const layer of Object.keys(DEFAULT_CONSENT)) {
      expect(HTML, layer).toContain(`id="${layer}"`);
      expect(keysOnThePage(), layer).toContain(layer);
      expect(Object.hasOwn(KO, layer), layer).toBe(true);
    }
  });
});

describe("the layer that reads the page", () => {
  it("says what it takes off the page and what it will not take", () => {
    const english = englishFor("page_desc").toLowerCase();
    expect(english).toContain("never what you type");
    expect(english).toContain("password");
    expect(KO.page_desc).toContain("입력한 값은");
    expect(KO.page_desc).toContain("비밀번호");
  });

  /**
   * The title and the headings are read, and on a document editor they are not words the site
   * wrote: a heading somebody typed is a real h1, and a tool that names the browser tab after
   * the document puts the name they gave it in the title. "Never what you type into a box" is
   * true and does not cover that, so the wording says it rather than leaving it to be found.
   */
  it("says a title or a heading can be something the person wrote", () => {
    const english = englishFor("page_desc").toLowerCase();
    expect(english).toContain("document editor");
    expect(english).toContain("heading");
    expect(KO.page_desc).toContain("문서 편집기");
    expect(KO.page_desc).toContain("제목");
  });

  it("is named in the line that used to speak for every layer at once", () => {
    // "shape only, for every layer below" became untrue the moment this layer existed
    expect(englishFor("lead").toLowerCase()).toContain("reads the page you are on");
    expect(KO.lead).toContain("페이지를 읽으며");
  });
});

describe("the layer this extension does not have", () => {
  it("is named on the page, because the page is where somebody looks", () => {
    // screen capture reads what is in a window. It belongs to the runtime, not here, and a
    // consent page that lists only this extension's layers reads as the whole promise.
    expect(keysOnThePage()).toContain("screenNote");
    expect(englishFor("screenNote").toLowerCase()).toContain("screen capture");
    expect(KO.screenNote).toContain("화면 캡처");
  });

  it("says it is off and that no switch here turns it on", () => {
    expect(englishFor("screenNote")).toContain("DM_CAPTURE");
    expect(KO.screenNote).toContain("DM_CAPTURE");
  });
});

/**
 * The store listing is the first consent wording anybody reads, and the only one they read before
 * installing. Chrome truncates a description past 132 characters, which would cut a sentence that
 * says what is never collected exactly where the qualification lives.
 */
describe("the description the store shows", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../public/manifest.json"), "utf8"),
  ) as { description: string };

  it("fits in what the store will print", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it("says it is this extension that is being described, not the whole product", () => {
    // the runtime has a layer that does read content; a description with no subject stood for it
    expect(manifest.description.toLowerCase()).toContain("this extension");
  });
});
