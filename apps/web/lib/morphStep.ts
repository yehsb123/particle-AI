import { t, type Lang } from "./i18n";

/** The steps the history strip can show that are not decision intents: a dismissal, or a morph
 *  whose decision named no intent. */
export const EXTRA_MORPH_STEPS = ["dismiss", "morph"] as const;

/**
 * What one step in the morph history did, in words.
 *
 * The strip used to print the intent itself with its underscore swapped for a space, so a Korean
 * reader saw English identifiers for every change the runtime had made. Anything without words
 * still falls back to that, since a readable identifier beats a blank chip.
 */
export function describeMorphStep(intent: string, lang: Lang): string {
  if (!intent) return "";
  const phrase = t(`step_${intent}`, lang);
  return phrase === `step_${intent}` ? intent.replace(/_/g, " ").trim() : phrase;
}
