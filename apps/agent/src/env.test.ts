import { describe, it, expect } from "vitest";
import { envNumber as agentEnvNumber } from "./shape";
import { envNumber as contractsEnvNumber } from "@particle/contracts";

/**
 * This agent takes no dependency on the workspace packages on purpose — somebody runs it on their
 * own machine — so it carries its own copy of this reader, the way it carries its own MAX_NAME.
 *
 * A copy is only safe while it stays a copy. This asserts the two give the same answer, so a
 * change to one that is not made to the other fails here rather than in the field.
 */
describe("the agent's environment reader matches the one in the contracts", () => {
  const cases: unknown[] = [undefined, null, "", "   ", "400", " 400 ", "0", "abc", "400ms", "true", "1e400", "8.5", "-5", "65535", "70000", 400];

  it("agrees on every value, answer or refusal", () => {
    for (const raw of cases) {
      const run = (fn: (v: unknown, f: number, n: string, min?: number, max?: number) => number) => {
        try {
          return { ok: true, value: fn(raw, 400, "DM_THING", 1, 65_535) };
        } catch (err) {
          return { ok: false, message: (err as Error).message };
        }
      };
      expect(run(agentEnvNumber), String(raw)).toEqual(run(contractsEnvNumber));
    }
  });

  it("gives the agent the default when the value is empty, which is what an env file usually holds", () => {
    // this is the case that mattered: DM_AGENT_DEBOUNCE_MS= used to make the debounce zero
    expect(agentEnvNumber("", 400, "DM_AGENT_DEBOUNCE_MS", 1, 2_147_483_647)).toBe(400);
  });
});
