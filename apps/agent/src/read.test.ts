import { describe, it, expect } from "vitest";
import { KNOWN_EVENT_TYPES, MAX_SCREEN_SUMMARY, type ScreenReading } from "@particle/contracts";
import { screenReadPayload, screenReader } from "./shape";

const reading: ScreenReading = {
  activity: "messaging",
  summary: "Two unread messages in a team chat.",
  topics: ["unread", "team chat"],
  needsAttention: true,
  confidence: 0.75,
};

const source = {
  app: "KakaoTalk",
  window: "team chat",
  path: "C:/Temp/particle-KakaoTalk.png",
  providerId: "mock",
  modelId: "deterministic",
};

/**
 * Reading is its own switch. Photographing a window and sending those pixels to a model are two
 * different things to consent to, and the second one is the one that takes them off this
 * machine (docs/CONSENT_V2.md).
 */
describe("whether a picture is read at all", () => {
  const brains = ["mock"];

  it("is off, silently, when nobody asked for it", () => {
    expect(screenReader(false, true, brains)).toEqual({ run: false, note: null });
  });

  it("stays off when the camera is off, however the reading switch is set", () => {
    expect(screenReader(true, false, brains).run).toBe(false);
    expect(screenReader(false, false, brains)).toEqual({ run: false, note: null });
  });

  it("says which switches are missing when somebody asked for reading and nothing is photographed", () => {
    const decision = screenReader(true, false, brains);
    expect(decision.note).toContain("DM_CAPTURE");
    expect(decision.note).toContain("DM_SCREEN_READ");
  });

  it("refuses to run with no brain that can be handed a picture", () => {
    const decision = screenReader(true, true, []);
    expect(decision.run).toBe(false);
    expect(decision.note).toContain("no brain");
  });

  /** Somebody who turned this on is told, once, where their pixels are about to go. */
  it("runs when both switches are on, and names the brains that may read", () => {
    const decision = screenReader(true, true, ["mock", "anthropic"]);
    expect(decision.run).toBe(true);
    expect(decision.note).toContain("mock, anthropic");
    expect(decision.note).toContain("DM_SCREEN_READ");
  });
});

describe("what a reading reports to the runtime", () => {
  it("reports a type the runtime knows", () => {
    expect(KNOWN_EVENT_TYPES as readonly string[]).toContain("sensor.screen_read");
  });

  it("carries the situation, who read it, and where the picture is", () => {
    const payload = screenReadPayload(reading, source);
    expect(payload).toEqual({
      app: "KakaoTalk",
      window: "team chat",
      path: "C:/Temp/particle-KakaoTalk.png",
      provider: "mock",
      model: "deterministic",
      activity: "messaging",
      summary: "Two unread messages in a team chat.",
      topics: "unread, team chat",
      needsAttention: true,
      confidence: 0.75,
    });
  });

  /**
   * The belief keeps a payload's scalar fields and leaves anything nested behind, so a list of
   * topics that travelled as a list would arrive as nothing at all.
   */
  it("is flat: every field is a string, a number or a flag", () => {
    for (const [key, value] of Object.entries(screenReadPayload(reading, source))) {
      expect(["string", "number", "boolean"], key).toContain(typeof value);
    }
  });

  it("carries no model at all rather than an empty one", () => {
    const payload = screenReadPayload(reading, { ...source, modelId: undefined });
    expect("model" in payload).toBe(false);
  });

  it("holds what the model wrote to the same length every other name is held to", () => {
    const payload = screenReadPayload(
      { ...reading, summary: "s".repeat(MAX_SCREEN_SUMMARY), topics: ["t".repeat(60), "u".repeat(60)] },
      source,
    );
    expect(String(payload.summary).length).toBeLessThanOrEqual(121);
    expect(String(payload.topics).length).toBeLessThanOrEqual(121);
  });

  it("takes an escape sequence out of a window title before it reaches a log line", () => {
    const payload = screenReadPayload(reading, { ...source, window: `team\u001b[2J chat` });
    expect(payload.window).toBe("team[2J chat");
  });
});
