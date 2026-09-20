import { describe, it, expect } from "vitest";
import { envNumber } from "./index";

/**
 * `Number()` is the wrong reader for an environment value. An empty value is the ordinary way an
 * env file says nothing — .env.example ships several — and `Number("")` is 0, not "unset".
 *
 * Measured before this, on the real code: `DM_AGENT_DEBOUNCE_MS=` made the debounce 0, so the
 * desktop agent sent an event per file save instead of one per burst; every malformed value did
 * the same, because "abc" and "400ms" become NaN and setTimeout treats NaN as 0, and a value past
 * the 32-bit timer maximum is clamped to 1ms. `DM_PORT=` opened the runtime on a random free port
 * (59648 in the run that showed it) that nothing else in the system knows how to reach. All of it
 * silently.
 *
 * Nothing means the default. Something unusable is refused out loud, because a person who typed a
 * value meant it, and running differently without mentioning it is the worse answer.
 */
describe("a number read from the environment", () => {
  it("is the default when nobody set it", () => {
    for (const nothing of [undefined, null, "", "   ", "\t"]) {
      expect(envNumber(nothing, 400, "X"), JSON.stringify(nothing) ?? "undefined").toBe(400);
    }
  });

  it("is the number when somebody set one", () => {
    expect(envNumber("8787", 1, "X")).toBe(8787);
    expect(envNumber(" 400 ", 1, "X")).toBe(400);
    expect(envNumber("0", 1, "X")).toBe(0);
  });

  it("refuses what is not a number, rather than becoming one", () => {
    // each of these used to become NaN or 0 and change behaviour without saying so
    for (const bad of ["abc", "400ms", "true", "1e400", "8.5", "-5"]) {
      expect(() => envNumber(bad, 400, "DM_THING", 1), bad).toThrow(/DM_THING/);
    }
  });

  it("says which variable and what it got", () => {
    const message = (() => {
      try {
        envNumber("400ms", 400, "DM_AGENT_DEBOUNCE_MS", 1, 2_147_483_647);
        return "";
      } catch (err) {
        return (err as Error).message;
      }
    })();
    expect(message).toContain("DM_AGENT_DEBOUNCE_MS");
    expect(message).toContain("400ms");
    expect(message).toContain("2147483647");
  });

  it("holds a value to the range the caller can actually use", () => {
    // a port outside 1..65535 is refused by the socket anyway; a timer past the 32-bit maximum is
    // silently clamped to 1ms, which is the debounce gone
    expect(() => envNumber("70000", 8787, "DM_PORT", 1, 65_535)).toThrow();
    expect(() => envNumber("0", 8787, "DM_PORT", 1, 65_535)).toThrow();
    expect(envNumber("65535", 8787, "DM_PORT", 1, 65_535)).toBe(65_535);
    expect(() => envNumber("2147483648", 400, "DM_AGENT_DEBOUNCE_MS", 1, 2_147_483_647)).toThrow();
    expect(envNumber("2147483647", 400, "DM_AGENT_DEBOUNCE_MS", 1, 2_147_483_647)).toBe(2_147_483_647);
  });

  it("takes a number as well as a string, since one may arrive either way", () => {
    expect(envNumber(400, 1, "X")).toBe(400);
  });
});
