import { describe, it, expect } from "vitest";
import { AI_PRESENCE_STATES } from "@particle/contracts";
import { parseServerMessage } from "./runtimeClient";
import { t } from "./i18n";

/**
 * The body shows what the AI is doing as a dot with a word beside it, and the word is looked up by
 * the state's own name — so a state with no translation is shown as itself.
 *
 * The runtime declared this union where it decides the next one, the body declared its own copy,
 * and the frame between them was checked only for being a string. Any string was a presence: an
 * empty one, `__proto__`, a five thousand character one, each of them arriving at the dot and
 * being printed beside it. One list in the contracts now, and the frame is checked against it.
 */
const S = "mine";
const frame = (state: unknown) => ({ kind: "ai_presence_changed", sessionId: S, state });

describe("what the AI can be doing", () => {
  it("is a state the body has words for, in both languages", () => {
    // A missing phrase comes back as the key itself in both languages, so the two being equal is
    // what catches one. Comparing against the key alone would not: "idle" is the English word for
    // idle, and a state whose English happens to read like its name is still translated.
    for (const state of AI_PRESENCE_STATES) {
      expect(t(state, "en").length, `en:${state}`).toBeGreaterThan(0);
      expect(t(state, "ko").length, `ko:${state}`).toBeGreaterThan(0);
      expect(t(state, "en"), state).not.toBe(t(state, "ko"));
    }
  });

  it("has a Korean word that is not the state's own name", () => {
    for (const state of AI_PRESENCE_STATES) {
      expect(t(state, "ko"), state).not.toBe(state);
    }
  });

  it("is told apart from every other one", () => {
    for (const lang of ["en", "ko"] as const) {
      const said = AI_PRESENCE_STATES.map((s) => t(s, lang));
      expect(new Set(said).size, lang).toBe(AI_PRESENCE_STATES.length);
    }
  });

  it("includes the one the runtime uses while it waits on a person", () => {
    expect(AI_PRESENCE_STATES).toContain("waiting_for_approval");
  });
});

describe("a frame saying what the AI is doing", () => {
  it("is taken for every state there is", () => {
    for (const state of AI_PRESENCE_STATES) {
      expect(parseServerMessage(frame(state), S), state).not.toBeNull();
    }
  });

  it("is dropped for a state nobody declared", () => {
    for (const state of ["thinking", "", "Observing", " acting", "a".repeat(5_000)]) {
      const label = state.length > 20 ? `${state.length} chars` : state;
      expect(parseServerMessage(frame(state), S), label).toBeNull();
    }
  });

  it("is dropped for a name that belongs to every object", () => {
    for (const state of ["__proto__", "constructor", "toString"]) {
      expect(parseServerMessage(frame(state), S), state).toBeNull();
    }
  });

  it("is dropped when the state is not a name at all", () => {
    for (const state of [undefined, null, 7, {}, [], true]) {
      expect(parseServerMessage(frame(state), S), JSON.stringify(state) ?? "undefined").toBeNull();
    }
  });

  it("is dropped when it is about another session", () => {
    expect(parseServerMessage(frame("acting"), "theirs")).toBeNull();
  });

  it("hands the state through as the body will use it", () => {
    const parsed = parseServerMessage(frame("waiting_for_approval"), S) as { state: string };
    expect(parsed.state).toBe("waiting_for_approval");
    expect(AI_PRESENCE_STATES as readonly string[]).toContain(parsed.state);
  });
});
