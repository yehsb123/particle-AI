import { describe, it, expect } from "vitest";
import { RuntimeDecision, UIMorphPlan, MAX_REASON_SUMMARY } from "./index";

/**
 * The reason summary is the one piece of model-written prose the product puts in front of a
 * person: the body shows it in the presence popover and under the inspector, as the answer to
 * "why did this change?".
 *
 * Nothing said how much of it there could be. A provider that ignored "concise" could write fifty
 * thousand characters into the interface, escape sequences and all, and both places rendered it
 * straight. The built-in provider writes about ninety.
 *
 * It is cleaned rather than refused: a summary that runs long is a provider being wordy, not a
 * decision being wrong, and throwing the decision away over its caption would cost the person the
 * reshaping it describes.
 */
const ESC = "\u001b";
const decision = (reasonSummary: unknown) => ({
  id: "d1",
  significance: 0.9,
  capabilityPlan: { capabilities: [] },
  uiPlan: { intent: "surface_incident", targetMode: "incident", confidence: 0.9, reasonSummary: "a plan" },
  autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
  reasonSummary,
});
const shown = (reasonSummary: unknown): string | undefined => {
  const parsed = RuntimeDecision.safeParse(decision(reasonSummary));
  return parsed.success ? parsed.data.reasonSummary : undefined;
};

describe("the reason a person is shown", () => {
  it("is what the provider wrote, when the provider was concise", () => {
    const sentence = "The service returned a runtime error, so the incident view is on screen.";
    expect(shown(sentence)).toBe(sentence);
  });

  it("is cut when a provider writes an essay, and says it was cut", () => {
    const long = shown("a".repeat(50_000))!;
    expect(long.length).toBe(MAX_REASON_SUMMARY + 1);
    expect(long.endsWith("…")).toBe(true);
  });

  it("still leaves the decision standing", () => {
    // the reshaping it describes is worth more than its caption
    const parsed = RuntimeDecision.safeParse(decision("a".repeat(50_000)));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.id).toBe("d1");
  });

  it("has room for more than one sentence", () => {
    const two = "The service returned a runtime error, so the incident view is on screen. The editor is untouched because it holds unsaved work.";
    expect(shown(two)).toBe(two);
    expect(MAX_REASON_SUMMARY).toBeGreaterThan(200);
  });

  it("carries none of the characters that are not writing", () => {
    expect(shown(`${ESC}[31mred${ESC}[0m`)).toBe("[31mred[0m");
    for (let code = 0; code < 0xa0; code += 1) {
      if (code >= 0x20 && code < 0x7f) continue;
      if (code === 0x0a) continue; // a sentence may wrap
      const char = String.fromCharCode(code);
      expect(shown(`a${char}b`), `U+${code.toString(16)}`).toBe("ab");
    }
  });

  it("keeps the newline a wrapped sentence has", () => {
    expect(shown("first line\nsecond line")).toBe("first line\nsecond line");
  });

  it("is still refused when there is none at all", () => {
    // a decision nobody can read is not auditable
    for (const empty of ["", undefined, null, 7, {}]) {
      expect(shown(empty), JSON.stringify(empty) ?? "undefined").toBeUndefined();
    }
  });

  it("is refused when it is only characters that cannot be read", () => {
    expect(shown(ESC)).toBe("");
  });
});

describe("the reason on the plan beside it", () => {
  const plan = (reasonSummary: unknown) =>
    UIMorphPlan.safeParse({ intent: "surface_incident", targetMode: "incident", confidence: 0.9, reasonSummary });

  it("is held to the same length", () => {
    const parsed = plan("b".repeat(50_000));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reasonSummary.length).toBe(MAX_REASON_SUMMARY + 1);
  });

  it("is cleaned the same way", () => {
    const parsed = plan(`${ESC}[2Jclear`);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reasonSummary).toBe("[2Jclear");
  });
});
