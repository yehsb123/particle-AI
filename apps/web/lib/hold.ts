import { t, type Lang } from "./i18n";

/**
 * Why the body did not change, in words.
 *
 * The runtime answers with reason codes; the person reads a sentence. A code nobody has written
 * words for still has to be shown — silently dropping it would leave the body saying it held back
 * without saying why, or saying only half of why — so anything unknown falls through as itself.
 */
export function describeHold(codes: readonly string[], lang: Lang): string {
  const said: string[] = [];
  if (!Array.isArray(codes)) return "";
  for (const code of codes) {
    // a code that is not a string is not a reason; it must not take the body down on its way out
    if (typeof code !== "string" || !code) continue;
    const phrase = t(`held_${code}`, lang);
    said.push(phrase === `held_${code}` ? code : phrase); // no words for it yet: say the code
  }
  return said.join(" · ");
}
