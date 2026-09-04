import { describe, it, expect } from "vitest";
import { MORPH_HOLD_REASONS } from "@particle/contracts";
import { describeHold } from "./hold";
import { t } from "./i18n";

/**
 * When the runtime decides not to reshape the body, it says so and says why — and the why is the
 * only thing standing between an interface that held back on purpose and one that looks broken.
 * The runtime answers in reason codes; this turns them into a sentence, in the reader's language.
 */
describe("every reason the runtime can give has words", () => {
  it("has an English and a Korean phrase for each one", () => {
    // a code added without words reaches the screen as a bare identifier, which is what this
    // catches: the list of reasons lives in the contracts, the words live here
    for (const reason of MORPH_HOLD_REASONS) {
      for (const lang of ["en", "ko"] as const) {
        const phrase = t(`held_${reason}`, lang);
        expect(phrase, `${lang}:${reason}`).not.toBe(`held_${reason}`);
        expect(phrase.length, `${lang}:${reason}`).toBeGreaterThan(4);
      }
    }
  });

  it("says something different in each language", () => {
    for (const reason of MORPH_HOLD_REASONS) {
      expect(t(`held_${reason}`, "en"), reason).not.toBe(t(`held_${reason}`, "ko"));
    }
  });

  it("explains each one to a person rather than naming it", () => {
    for (const reason of MORPH_HOLD_REASONS) {
      expect(describeHold([reason], "en"), reason).not.toBe(reason);
      expect(describeHold([reason], "ko"), reason).not.toBe(reason);
    }
  });
});

describe("turning reasons into a sentence", () => {
  it("reads a single reason in the language asked for", () => {
    expect(describeHold(["protects_unsaved_state"], "en")).toContain("unsaved");
    expect(describeHold(["protects_unsaved_state"], "ko")).toContain("미저장");
  });

  it("joins several reasons", () => {
    const said = describeHold(["cooldown_active", "protects_focus"], "en");
    expect(said).toContain("·");
    expect(said.split(" · ")).toHaveLength(2);
  });

  it("still shows a reason nobody has written words for", () => {
    // dropping it would leave the body saying it held back without saying why
    expect(describeHold(["some_new_reason"], "en")).toBe("some_new_reason");
  });

  it("keeps an unknown reason alongside the ones it can read", () => {
    const said = describeHold(["cooldown_active", "some_new_reason"], "en");
    expect(said).toContain("some_new_reason");
    expect(said.split(" · ")).toHaveLength(2);
    expect(said).not.toContain("held_");
  });

  it("has nothing to say when there is nothing to say", () => {
    expect(describeHold([], "en")).toBe("");
    expect(describeHold(["", ""], "en")).toBe("");
  });

  it("never leaks the key it looked the words up by", () => {
    for (const codes of [["cooldown_active"], ["learned_preference", "structurally_impossible"], ["nonsense"]]) {
      expect(describeHold(codes, "en"), codes.join()).not.toContain("held_");
      expect(describeHold(codes, "ko"), codes.join()).not.toContain("held_");
    }
  });

  it("is not confused by a reason named after a property of every object", () => {
    for (const code of ["toString", "constructor", "__proto__"]) {
      expect(describeHold([code], "en"), code).toBe(code);
    }
  });
});
