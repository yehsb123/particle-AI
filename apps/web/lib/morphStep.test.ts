import { describe, it, expect } from "vitest";
import { UIMorphIntent } from "@particle/contracts";
import { describeMorphStep, EXTRA_MORPH_STEPS } from "./morphStep";
import { t } from "./i18n";

/**
 * The history strip is the record of everything the runtime did to the interface, and every chip
 * in it is something a person can click to undo back to. It used to print the intent itself with
 * its underscore swapped for a space, so a Korean reader saw English identifiers for every change
 * that had been made to their own screen.
 */
const everyStep = [...UIMorphIntent.options, ...EXTRA_MORPH_STEPS];

describe("every step the strip can show has words", () => {
  it("has an English and a Korean phrase for each", () => {
    for (const step of everyStep) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`step_${step}`, lang), `${lang}:${step}`).not.toBe(`step_${step}`);
      }
    }
  });

  it("says something different in each language", () => {
    for (const step of everyStep) {
      expect(t(`step_${step}`, "en"), step).not.toBe(t(`step_${step}`, "ko"));
    }
  });

  it("describes each step rather than naming it", () => {
    for (const step of everyStep) {
      expect(describeMorphStep(step, "en"), step).not.toBe(step);
      expect(describeMorphStep(step, "ko"), step).not.toBe(step);
      expect(describeMorphStep(step, "ko"), step).not.toMatch(/[a-z]_[a-z]/); // no identifiers left
    }
  });
});

describe("turning a step into words", () => {
  it("reads the ones the runtime plans", () => {
    expect(describeMorphStep("surface_incident", "en")).toContain("incident");
    expect(describeMorphStep("restore_normal", "ko")).toContain("평소");
    expect(describeMorphStep("augment", "ko")).toContain("컨텍스트");
  });

  it("reads the ones only the body makes", () => {
    expect(describeMorphStep("dismiss", "en")).toContain("dismissed");
    expect(describeMorphStep("morph", "ko")).toContain("레이아웃");
  });

  it("falls back to a readable identifier for a step nobody wrote words for", () => {
    // a readable identifier beats a blank chip in a strip someone clicks to undo
    expect(describeMorphStep("some_new_step", "en")).toBe("some new step");
    expect(describeMorphStep("two_words_here", "ko")).toBe("two words here");
  });

  it("has nothing to show for nothing", () => {
    expect(describeMorphStep("", "en")).toBe("");
  });

  it("never leaves the lookup key on the screen", () => {
    for (const step of [...everyStep, "unknown_step"]) {
      expect(describeMorphStep(step, "en"), step).not.toContain("step_");
      expect(describeMorphStep(step, "ko"), step).not.toContain("step_");
    }
  });

  it("is not confused by a step named after a property of every object", () => {
    expect(describeMorphStep("toString", "en")).toBe("toString");
    expect(describeMorphStep("constructor", "en")).toBe("constructor");
    expect(describeMorphStep("__proto__", "en")).toBe("proto"); // underscores read as spaces, then trimmed
  });
});
