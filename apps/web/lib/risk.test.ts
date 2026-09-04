import { describe, it, expect } from "vitest";
import { RISK_LEVELS, type AutonomyLevel } from "@particle/contracts";
import { canAutoRun } from "@particle/permission-engine";
import { describeRisk, describeAutonomy, riskBadgeClass, riskTone } from "./risk";
import { t } from "./i18n";

/**
 * The body used to describe the permission policy from memory. The approval card wore a fixed
 * critical badge whatever the risk was and named the risk with its own identifier, and the hint
 * under the level chooser told the person that at L0 and L1 even reads need consent — the policy
 * denies them outright, so anyone who followed it waited for a card the runtime never sends.
 *
 * These assertions are written against `canAutoRun`, the policy itself, rather than against a
 * table copied out of it: if the policy changes, what the body says has to change with it or
 * these fail.
 */
const LEVELS: AutonomyLevel[] = [0, 1, 2, 3, 4];

describe("every risk a person can be asked to allow", () => {
  it("has words in both languages", () => {
    for (const risk of RISK_LEVELS) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`risk_${risk}`, lang), `${lang}:${risk}`).not.toBe(`risk_${risk}`);
      }
      expect(t(`risk_${risk}`, "en"), risk).not.toBe(t(`risk_${risk}`, "ko"));
    }
  });

  it("is named rather than spelled out as its identifier", () => {
    for (const risk of RISK_LEVELS) {
      for (const lang of ["en", "ko"] as const) {
        const said = describeRisk(risk, lang);
        expect(said, `${lang}:${risk}`).not.toBe(risk);
        expect(said, `${lang}:${risk}`).not.toContain("_");
      }
    }
  });

  it("is told apart from every other one", () => {
    for (const lang of ["en", "ko"] as const) {
      const said = RISK_LEVELS.map((risk) => describeRisk(risk, lang));
      expect(new Set(said).size, lang).toBe(RISK_LEVELS.length);
    }
  });
});

describe("the badge on the approval card", () => {
  it("is loudest for what the policy will never run on its own", () => {
    for (const risk of RISK_LEVELS) {
      const neverAutomatic = !canAutoRun(risk, 4);
      expect(riskTone(risk) === "crit", risk).toBe(neverAutomatic);
    }
  });

  it("is quiet for what this runtime would have run without asking anyway", () => {
    // a read held back only because its server is not allowed yet is not a red alarm
    for (const risk of RISK_LEVELS) {
      if (canAutoRun(risk, 3)) expect(riskTone(risk), risk).toBe("neutral");
    }
    expect(riskBadgeClass("read")).toBe("badge");
  });

  it("is one of the three the stylesheet knows, always", () => {
    for (const risk of [...RISK_LEVELS, "wipe_everything", "", "__proto__", "constructor"]) {
      expect(["badge", "badge warn", "badge crit"], risk).toContain(riskBadgeClass(risk));
    }
  });

  it("does not call a risk it cannot place a quiet one", () => {
    for (const risk of ["wipe_everything", "", "__proto__"]) {
      expect(riskTone(risk), risk).not.toBe("neutral");
    }
  });

  it("still names a risk nobody has written words for, readably", () => {
    expect(describeRisk("wipe_everything", "en")).toBe("wipe everything");
    expect(describeRisk("wipe_everything", "ko")).not.toContain("risk_");
  });
});

describe("what each autonomy level says it does", () => {
  it("names exactly the risks the policy runs at that level", () => {
    for (const level of LEVELS) {
      const said = describeAutonomy(level, "en");
      for (const risk of RISK_LEVELS) {
        const named = said.includes(describeRisk(risk, "en"));
        expect(named, `L${level} ${risk}`).toBe(canAutoRun(risk, level));
      }
    }
  });

  it("says the AI does not act at all where the policy lets it do nothing", () => {
    for (const level of LEVELS) {
      const actsAtAll = RISK_LEVELS.some((risk) => canAutoRun(risk, level));
      expect(describeAutonomy(level, "en") === t("autonomyRunsNothing", "en"), `L${level}`).toBe(!actsAtAll);
    }
  });

  it("never promises a person that a level asks when it in fact refuses", () => {
    // the sentence the hint used to make: at L0/L1 even reads need consent. They do not; they
    // are denied, and no approval card is ever sent.
    for (const level of [0, 1] as const) {
      for (const lang of ["en", "ko"] as const) {
        expect(describeAutonomy(level, lang), `L${level} ${lang}`).toBe(t("autonomyRunsNothing", lang));
      }
    }
  });

  it("grows as the level rises and never shrinks", () => {
    let previous = 0;
    for (const level of LEVELS) {
      const count = RISK_LEVELS.filter((risk) => describeAutonomy(level, "en").includes(describeRisk(risk, "en"))).length;
      expect(count, `L${level}`).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("is a sentence in both languages at every level, with no slot left unfilled", () => {
    for (const level of LEVELS) {
      for (const lang of ["en", "ko"] as const) {
        const said = describeAutonomy(level, lang);
        expect(said.length, `L${level} ${lang}`).toBeGreaterThan(10);
        expect(said, `L${level} ${lang}`).not.toContain("{");
        expect(said, `L${level} ${lang}`).not.toContain("autonomy_");
      }
      expect(describeAutonomy(level, "en"), `L${level}`).not.toBe(describeAutonomy(level, "ko"));
    }
  });
});
