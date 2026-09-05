import { describe, it, expect } from "vitest";
import { INTENT_LABELS, MAX_IDENTIFIER } from "@particle/contracts";
import { describeIntent } from "./intent";
import { parseSessions } from "./runtimeClient";
import { t } from "./i18n";

/**
 * What the runtime believes a person is doing is shown in three places: the presence popover, the
 * inspector, and the row for every other session this runtime senses. Each looked the label up by
 * name and printed whatever came back, so a label with no words behind it reached the screen as
 * the lookup key with its prefix still on — a session whose runtime had inferred something newer
 * read "intent_thinking" in the rail.
 *
 * The label stays open, unlike the presence beside it: a presence is a fixed state the body draws
 * a styled dot for, so one it does not know is not a presence, while an intent is something a
 * runtime worked out about a person and a newer one may have worked out something this build has
 * never heard of. Showing that readably tells the reader more than erasing it does.
 */
describe("every intent the runtime can infer", () => {
  it("has words in both languages", () => {
    // a missing phrase comes back as the key in both, so the two being equal is what catches one
    for (const label of INTENT_LABELS) {
      expect(t(`intent_${label}`, "en").length, `en:${label}`).toBeGreaterThan(0);
      expect(t(`intent_${label}`, "ko").length, `ko:${label}`).toBeGreaterThan(0);
      expect(t(`intent_${label}`, "en"), label).not.toBe(t(`intent_${label}`, "ko"));
    }
  });

  it("is shown as a phrase rather than as its lookup key", () => {
    for (const label of INTENT_LABELS) {
      for (const lang of ["en", "ko"] as const) {
        const shown = describeIntent(label, lang);
        expect(shown, `${lang}:${label}`).not.toContain("intent_");
        expect(shown.length, `${lang}:${label}`).toBeGreaterThan(0);
      }
    }
  });

  it("is told apart from every other one", () => {
    for (const lang of ["en", "ko"] as const) {
      const said = INTENT_LABELS.map((l) => describeIntent(l, lang));
      expect(new Set(said).size, lang).toBe(INTENT_LABELS.length);
    }
  });
});

describe("an intent this build has never heard of", () => {
  it("is shown, readably, rather than as a key", () => {
    expect(describeIntent("thinking", "en")).toBe("thinking");
    expect(describeIntent("deep_work", "en")).toBe("deep work");
    expect(describeIntent("pair-programming", "ko")).toBe("pair programming");
  });

  it("never leaves the prefix on the screen", () => {
    for (const label of [...INTENT_LABELS, "thinking", "__proto__", "constructor"]) {
      for (const lang of ["en", "ko"] as const) {
        expect(describeIntent(label, lang), `${lang}:${label}`).not.toContain("intent_");
      }
    }
  });

  it("is cut to a length someone reads", () => {
    const shown = describeIntent("a".repeat(1_000), "en");
    expect(shown.length).toBe(MAX_IDENTIFIER + 1);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("says nothing for a label that is not one", () => {
    for (const label of [undefined, null, 7, {}, [], true, "", "   "]) {
      expect(describeIntent(label, "en"), JSON.stringify(label) ?? "undefined").toBe("");
    }
  });
});

describe("the intent on another session's row", () => {
  const intentOf = (intent: unknown) => parseSessions({ sessions: [{ sessionId: "s", intent }] })[0]?.intent;

  it("is kept when it names something", () => {
    expect(intentOf("debugging")).toBe("debugging");
    expect(intentOf("thinking")).toBe("thinking");
  });

  it("is dropped when it names nothing", () => {
    // the row falls back to a dash; an intent with no name is not an intent
    for (const intent of ["", "   ", undefined, null, 7, {}, []]) {
      expect(intentOf(intent), JSON.stringify(intent) ?? "undefined").toBeUndefined();
    }
  });

  it("leaves the session listed either way", () => {
    for (const intent of ["debugging", "", 7]) {
      expect(parseSessions({ sessions: [{ sessionId: "s", intent }] }), JSON.stringify(intent)).toHaveLength(1);
    }
  });
});
