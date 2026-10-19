import { z } from "zod";
import { Confidence } from "./common";

/**
 * What a model is allowed to say about a photographed window.
 *
 * The picture is the one thing this repository reads rather than shapes, so what comes back from
 * reading it is held to the same bargain as everything else a model emits: it is data against a
 * schema, never prose the runtime believes. A model that answers with an essay, with a word
 * nobody defined, or with an instruction aimed at whoever reads the log produces a reading that
 * fails here and never reaches the runtime.
 */

/**
 * The situations a window can be in, as far as this runtime acts on them.
 *
 * Closed on purpose and short on purpose. The runtime routes on this value — it is the one field
 * of a reading that is a key rather than a caption — and a vocabulary that grows with whatever a
 * model felt like saying is not a vocabulary. `unclear` is in it so that a model which cannot
 * tell has something true to answer; it is a choice the model makes, never one made for it.
 */
export const SCREEN_ACTIVITIES = [
  "messaging",
  "reading",
  "writing",
  "spreadsheet",
  "media",
  "error",
  "waiting",
  "unclear",
] as const;

export const ScreenActivity = z.enum(SCREEN_ACTIVITIES);
export type ScreenActivity = z.infer<typeof ScreenActivity>;

/**
 * How much of a reading travels.
 *
 * A summary is one sentence somebody reads in a row of a list, and topics are words, not notes.
 * Both are ceilings rather than targets: the point is that nothing a model writes can grow the
 * event, the belief, the broadcast and the next prompt the way an unbounded answer would.
 */
export const MAX_SCREEN_SUMMARY = 200;
export const MAX_SCREEN_TOPICS = 5;
export const MAX_SCREEN_TOPIC = 60;

/** The characters that are not writing. A model's answer is printed by a terminal like any other. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * A caption a model wrote, made fit to carry and to print.
 *
 * Cut rather than refused: a caption that is too long is still the right caption, and losing the
 * whole reading over its length would throw away the activity and the attention flag with it.
 * The fields that are refused instead are the ones the runtime acts on.
 */
function caption(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export const ScreenReading = z.object({
  /** what is going on in the window; refused when it is not one of the words above */
  activity: ScreenActivity,
  /** one sentence about the situation, for a person to read */
  summary: z
    .unknown()
    .transform((value) => caption(value, MAX_SCREEN_SUMMARY))
    .refine((summary) => summary.length > 0, { message: "a reading with nothing in its summary is not a reading" }),
  /**
   * The few words the window is about. Anything that is not writing is dropped and the list is
   * cut to the cap, because a reading with five good topics and a sixth bad one is still a
   * reading — unlike the activity, nothing is looked up by these.
   */
  topics: z.unknown().transform((value) => {
    if (!Array.isArray(value)) return [];
    const topics: string[] = [];
    for (const entry of value) {
      if (topics.length >= MAX_SCREEN_TOPICS) break;
      const topic = caption(entry, MAX_SCREEN_TOPIC);
      if (topic) topics.push(topic);
    }
    return topics;
  }),
  /** whether the window is waiting on the person; the runtime acts on it, so it must be an answer */
  needsAttention: z.boolean(),
  /** how sure the model is, which is what the runtime weighs the rest of this against */
  confidence: Confidence,
});
export type ScreenReading = z.infer<typeof ScreenReading>;
