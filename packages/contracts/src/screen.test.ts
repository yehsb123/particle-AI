import { describe, it, expect } from "vitest";
import {
  MAX_SCREEN_SUMMARY,
  MAX_SCREEN_TOPIC,
  MAX_SCREEN_TOPICS,
  SCREEN_ACTIVITIES,
  ScreenReading,
} from "./screen";

/** A reading a well-behaved model would hand back. */
const good = {
  activity: "messaging",
  summary: "A chat window with two unread messages from a colleague.",
  topics: ["unread", "colleague"],
  needsAttention: true,
  confidence: 0.8,
};

describe("what a model is allowed to say about a window", () => {
  it("takes a reading that answers every field", () => {
    const parsed = ScreenReading.parse(good);
    expect(parsed.activity).toBe("messaging");
    expect(parsed.topics).toEqual(["unread", "colleague"]);
    expect(parsed.needsAttention).toBe(true);
  });

  it("takes a reading with no topics, because a window may be about nothing in particular", () => {
    const parsed = ScreenReading.parse({ ...good, topics: [] });
    expect(parsed.topics).toEqual([]);
  });

  it("lets a model say it cannot tell", () => {
    expect(SCREEN_ACTIVITIES).toContain("unclear");
    expect(ScreenReading.parse({ ...good, activity: "unclear", confidence: 0 }).activity).toBe("unclear");
  });

  // The activity is the field the runtime acts on, so a word outside the vocabulary is refused
  // rather than turned into "unclear": a guess here would be a decision nobody made.
  it("refuses an activity outside the vocabulary rather than guessing one", () => {
    const result = ScreenReading.safeParse({ ...good, activity: "panicking" });
    expect(result.success).toBe(false);
  });

  it("refuses a confidence that is not a number between 0 and 1", () => {
    expect(ScreenReading.safeParse({ ...good, confidence: 4 }).success).toBe(false);
    expect(ScreenReading.safeParse({ ...good, confidence: "high" }).success).toBe(false);
  });

  it("refuses an attention flag that is not an answer", () => {
    expect(ScreenReading.safeParse({ ...good, needsAttention: "maybe" }).success).toBe(false);
  });

  it("refuses a reading with no summary at all", () => {
    expect(ScreenReading.safeParse({ ...good, summary: "   " }).success).toBe(false);
    expect(ScreenReading.safeParse({ activity: "reading", confidence: 0.5, needsAttention: false }).success).toBe(false);
  });

  // A summary is a caption somebody reads, not a key anything is looked up by, so an overlong
  // one is cut to the cap instead of taking the whole reading down with it.
  it("cuts a summary longer than the cap instead of losing the reading", () => {
    const parsed = ScreenReading.parse({ ...good, summary: "x".repeat(MAX_SCREEN_SUMMARY * 4) });
    expect(parsed.summary.length).toBeLessThanOrEqual(MAX_SCREEN_SUMMARY + 1);
    expect(parsed.summary.startsWith("xxx")).toBe(true);
  });

  it("drops the topics past the cap and cuts the long ones", () => {
    const parsed = ScreenReading.parse({
      ...good,
      topics: [...Array.from({ length: MAX_SCREEN_TOPICS * 3 }, (_, i) => `topic${i}`), "y".repeat(MAX_SCREEN_TOPIC * 5)],
    });
    expect(parsed.topics).toHaveLength(MAX_SCREEN_TOPICS);
    for (const topic of parsed.topics) expect(topic.length).toBeLessThanOrEqual(MAX_SCREEN_TOPIC + 1);
  });

  it("drops a topic that is not writing rather than carrying it", () => {
    const parsed = ScreenReading.parse({ ...good, topics: ["   ", "kept", 7, null] });
    expect(parsed.topics).toEqual(["kept"]);
  });

  it("reads a topic list that is not a list as no topics", () => {
    expect(ScreenReading.parse({ ...good, topics: "unread, colleague" }).topics).toEqual([]);
    expect(ScreenReading.parse({ activity: "reading", summary: "a page", needsAttention: false, confidence: 0.5 }).topics).toEqual([]);
  });

  /**
   * A model writes the summary, and an escape sequence in it is an instruction to the terminal
   * that prints the agent's line. The same rule every other observed name in this repository is
   * held to.
   */
  it("takes the control characters out of what the model wrote", () => {
    const parsed = ScreenReading.parse({
      ...good,
      summary: `a\u001b[31mred\u0007 summary`,
      topics: [`to\u0008pic`],
    });
    expect(parsed.summary).toBe("a[31mred summary");
    expect(parsed.topics).toEqual(["topic"]);
  });

  it("refuses anything that is not an object at all", () => {
    for (const junk of ["a sentence", 42, null, [good]]) {
      expect(ScreenReading.safeParse(junk).success, JSON.stringify(junk)).toBe(false);
    }
  });

  it("ignores fields a model invented", () => {
    const parsed = ScreenReading.parse({ ...good, nextStep: "rm -rf /", password: "hunter2" });
    expect(Object.keys(parsed).sort()).toEqual(["activity", "confidence", "needsAttention", "summary", "topics"]);
  });
});
