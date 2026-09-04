import { t, type Lang } from "./i18n";

/**
 * Who is sensing, and what they are sensing, in words.
 *
 * The indicator is the runtime's honesty about what it can see, so a name nobody has written
 * words for is still shown — as itself, readably — rather than dropped. Saying "some sensor I
 * cannot name is watching" is worth more than saying nothing is.
 */
export function describeSensor(name: string, lang: Lang): string {
  return readable(`sensor_${name}`, name, lang);
}

export function describeLayer(name: string, lang: Lang): string {
  return readable(`layer_${name}`, name, lang);
}

function readable(key: string, name: string, lang: Lang): string {
  const phrase = t(key, lang);
  return phrase === key ? name.replace(/[_-]/g, " ").trim() : phrase;
}
