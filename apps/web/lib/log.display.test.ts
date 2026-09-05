import { describe, it, expect } from "vitest";
import { UIAction, MAX_IDENTIFIER } from "@particle/contracts";
import { text as displayText, MAX_TEXT } from "../components/Renderer";

/**
 * The activity log is the third surface that shows values from outside. The renderer and the
 * inspector are the other two, and both read through the same helper; this one rendered whatever
 * it was handed. What it is handed includes names a model wrote — the capability an action names,
 * the reason codes a morph was held for, the id of a patch.
 *
 * An action is where a model's name stops being a caption and becomes something the runtime acts
 * on: it decides what pressing a button asks for. So the name is held to the length every other
 * identifier is, and refused rather than trimmed, for the same reason a component id is — two
 * names cut to the same length would ask the runtime for the same thing.
 */
const ESC = "\u001b";
const action = (over: Record<string, unknown> = {}) => UIAction.safeParse({ event: "user.requested_undo", ...over });

describe("what an action may name", () => {
  it("is the event the body emits when the button is pressed", () => {
    const parsed = action();
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.event).toBe("user.requested_undo");
  });

  it("is held to the length every other identifier is", () => {
    expect(action({ event: "e".repeat(MAX_IDENTIFIER) }).success).toBe(true);
    expect(action({ event: "e".repeat(MAX_IDENTIFIER + 1) }).success).toBe(false);
    expect(action({ event: "e".repeat(50_000) }).success).toBe(false);
  });

  it("holds the capability it names to the same length", () => {
    expect(action({ capabilityId: "development.read_logs" }).success).toBe(true);
    expect(action({ capabilityId: "c".repeat(50_000) }).success).toBe(false);
    expect(action({ capabilityId: "" }).success).toBe(false);
  });

  it("holds its own words to the same length", () => {
    expect(action({ label: "Undo" }).success).toBe(true);
    expect(action({ label: "l".repeat(50_000) }).success).toBe(false);
  });

  it("still needs an event to be an action at all", () => {
    for (const event of ["", undefined, null, 7, {}]) {
      expect(action({ event }).success, JSON.stringify(event) ?? "undefined").toBe(false);
    }
  });
});

describe("a line the activity log shows", () => {
  it("says what it was given", () => {
    expect(displayText("action — development.read_logs")).toBe("action — development.read_logs");
  });

  it("is cut when it is longer than anyone reads", () => {
    const line = displayText(`action — ${"c".repeat(50_000)}`);
    expect(line.length).toBeLessThanOrEqual(MAX_TEXT + 1);
    expect(line.endsWith("…")).toBe(true);
  });

  it("carries none of the characters that are not writing", () => {
    expect(displayText(`action — ${ESC}[31mread_logs`)).toBe("action — [31mread_logs");
    for (let code = 0; code < 0xa0; code += 1) {
      if (code >= 0x20 && code < 0x7f) continue;
      if (code === 0x0a || code === 0x09) continue; // whitespace a line may hold
      expect(displayText(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe("ab");
    }
  });

  it("says nothing rather than something wrong when handed what is not a line", () => {
    for (const value of [undefined, null, {}, []]) {
      expect(displayText(value as unknown as string), JSON.stringify(value) ?? "undefined").toBe("");
    }
  });
});
