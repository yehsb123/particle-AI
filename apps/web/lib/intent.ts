import { MAX_IDENTIFIER } from "@particle/contracts";
import { t, type Lang } from "./i18n";

/**
 * What the runtime believes a person is doing, in words.
 *
 * Three places show this — the presence popover, the inspector, and the row for every other
 * session this runtime senses — and each looked the label up by name and printed whatever came
 * back. A label the body has no words for came back as the lookup key itself, so a session whose
 * runtime had inferred something newer read "intent_thinking" in the rail.
 *
 * The label stays open, unlike the presence beside it. A presence is a fixed state the body draws
 * a styled dot for, so one it does not know is not a presence. An intent is something a runtime
 * worked out about a person, and a newer one may have worked out something this build has never
 * heard of — showing that readably tells the reader more than erasing it does.
 */
export function describeIntent(label: unknown, lang: Lang): string {
  if (typeof label !== "string") return "";
  const name = label.trim();
  if (!name) return "";
  const phrase = t(`intent_${name}`, lang);
  if (phrase !== `intent_${name}`) return phrase;
  // nobody has written words for it: show the name itself, readably and at a length someone reads
  const readable = name.replace(/[_-]/g, " ").trim();
  return readable.length > MAX_IDENTIFIER ? `${readable.slice(0, MAX_IDENTIFIER)}…` : readable;
}
