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

/**
 * The layer that takes a picture of a window instead of reporting the shape of one.
 *
 * It is the only layer in `SENSING_LAYERS` that reads what is in a window, so the indicator has
 * to treat it apart from the rest rather than sweep it into "shape only" (docs/CONSENT_V2.md).
 */
export const SCREEN_LAYER = "screen";

/**
 * A layer may say what it is pointed at: `screen:KakaoTalk`.
 *
 * Which window is being photographed is the part of this layer a person needs, and the layer list
 * in the contracts is a list of layers rather than a list of apps — so the app travels with the
 * layer name and is split off here, where the words are. A qualifier on a layer nobody wrote
 * words for still comes out readably, the same way an unknown layer does.
 */
export function describeLayer(name: string, lang: Lang): string {
  const mark = typeof name === "string" ? name.indexOf(":") : -1;
  if (mark <= 0) return readable(`layer_${name}`, name, lang);
  const layer = readable(`layer_${name.slice(0, mark)}`, name.slice(0, mark), lang);
  const target = name.slice(mark + 1).trim();
  return target ? `${layer}: ${target}` : layer;
}

/**
 * Is one of these layers reading what is in a window, rather than the shape of it?
 *
 * The list comes off a world state, which a snapshot can have written, so a name that is not a
 * name is answered rather than thrown on — the same rule the rest of this file follows.
 */
export function sensesContent(layers: readonly string[]): boolean {
  return layers.some((l) => typeof l === "string" && (l === SCREEN_LAYER || l.startsWith(`${SCREEN_LAYER}:`)));
}

function readable(key: string, name: string, lang: Lang): string {
  // a name that is not a name has nothing to say, and saying it must not take the body down
  if (typeof name !== "string" || !name) return "";
  const phrase = t(key, lang);
  return phrase === key ? name.replace(/[_-]/g, " ").trim() : phrase;
}
