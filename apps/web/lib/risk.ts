import type { AutonomyLevel, RiskLevel } from "@particle/contracts";
import { RISK_LEVELS } from "@particle/contracts";
import { canAutoRun } from "@particle/permission-engine";
import { t, fillTemplate, type Lang } from "./i18n";

/**
 * What the body says about risk and about what an autonomy level does.
 *
 * Both were written out by hand beside the policy rather than read from it. The approval card
 * carried a fixed critical badge whatever the risk was, and named the risk with its own
 * identifier, so a person was shown a red `external_effect` in either language. The hint under
 * the level chooser claimed that at L0 and L1 even reads need consent — the policy denies them
 * outright, so a person who followed it and set L0 waited for an approval card that the runtime
 * would never send.
 *
 * Everything here is derived from `canAutoRun`, so the account cannot drift from the policy: if
 * a level stops running something on its own, the sentence changes with it.
 */

/** How loud the badge for a risk should be, from how far the policy will let it go unasked. */
export function riskTone(risk: string): "neutral" | "warn" | "crit" {
  if (!isRisk(risk)) return "warn"; // a risk we do not know is not one we can call quiet
  if (!canAutoRun(risk, 4)) return "crit"; // nothing runs this on its own, ever
  if (!canAutoRun(risk, 3)) return "warn"; // only the most permissive level does
  return "neutral";
}

export function riskBadgeClass(risk: string): string {
  const tone = riskTone(risk);
  return tone === "neutral" ? "badge" : `badge ${tone}`;
}

/** A risk in words. An identifier nobody has written words for is still shown, readably. */
export function describeRisk(risk: string, lang: Lang): string {
  if (typeof risk !== "string" || !risk) return "";
  const key = `risk_${risk}`;
  const phrase = t(key, lang);
  return phrase === key ? risk.replace(/[_-]/g, " ").trim() : phrase;
}

/** What a level actually does, in words, read from the policy rather than said about it. */
export function describeAutonomy(level: AutonomyLevel, lang: Lang): string {
  const onItsOwn = RISK_LEVELS.filter((risk) => canAutoRun(risk, level));
  if (onItsOwn.length === 0) return t("autonomyRunsNothing", lang);
  const risks = onItsOwn.map((risk) => describeRisk(risk, lang)).join(", ");
  return fillTemplate(t("autonomyRunsThese", lang), { risks });
}

function isRisk(risk: string): risk is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(risk);
}
