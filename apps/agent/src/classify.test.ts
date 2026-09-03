import { describe, it, expect } from "vitest";
import { classifyLine, OutputTracker } from "./shape";

/**
 * The agent reads whatever you pipe into it, and a test run's output is mixed with the
 * application's own logging. Anything that is not a run changing state must stay silent —
 * otherwise the body opens an incident because a request in an integration test returned 500.
 */
describe("classifyLine — an app log is not a test result", () => {
  const quiet = [
    "GET /users/42 failed with 500",
    "Error: 3 failed login attempts detected",
    "warn: 2 failing health checks in cluster",
    "TODO: fix the failed migration script",
    "Downloaded 42 passed certificates",
    "[particle-agent] runtime rejected development.test_failed: 401",
    "npm ERR! code ELIFECYCLE",
    "at Object.<anonymous> (/app/test.js:1:1)",
    "const password = 'hunter2'",
    "",
    "   ",
  ];

  it("stays silent on prose, log lines and stack frames", () => {
    for (const line of quiet) expect(classifyLine(line), line).toBeNull();
  });

  it("still recognises the summary lines of every runner we support", () => {
    const summaries: [string, ReturnType<typeof classifyLine>][] = [
      ["      Tests  1 failed | 17 passed (18)", "test_fail"],
      ["      Tests  18 passed (18)", "test_pass"],
      ["Tests:       2 failed, 5 passed, 7 total", "test_fail"],
      ["Tests:       7 passed, 7 total", "test_pass"],
      ["  1 failing", "test_fail"],
      ["  3 passing (40ms)", "test_pass"],
      ["  1 failed", "test_fail"],
      ["  15 passed (1.1m)", "test_pass"],
      [" FAIL  src/shape.test.ts > x", "test_fail"],
    ];
    for (const [line, expected] of summaries) expect(classifyLine(line), line).toBe(expected);
  });

  it("reads a compiler error as a build failure, not a test failure", () => {
    expect(classifyLine("src/a.ts(3,5): error TS2345: Argument of type")).toBe("build_fail");
    expect(classifyLine("Found 2 errors in 1 file.")).toBe("build_fail");
    expect(classifyLine("Failed to compile.")).toBe("build_fail");
    expect(classifyLine(" ✓ Compiled successfully in 4.2s")).toBe("build_ok");
    expect(classifyLine("✓ built in 812ms")).toBe("build_ok");
  });
});

describe("OutputTracker — a watch run reports transitions, not every line", () => {
  it("stays quiet while the state holds and speaks only when it flips", () => {
    const t = new OutputTracker();
    const say = (line: string) => t.feed(line)?.type ?? null;

    // a long failing watch session: only the first line is news
    expect(say("      Tests  2 failed | 5 passed (7)")).toBe("development.test_failed");
    expect(say("      Tests  2 failed | 5 passed (7)")).toBeNull();
    expect(say("      Tests  3 failed | 4 passed (7)")).toBeNull();
    expect(say("GET /users failed with 500")).toBeNull(); // app noise never moves the state

    // it goes green: that is a recovery
    expect(say("      Tests  7 passed (7)")).toBe("development.test_passed");
    expect(say("      Tests  7 passed (7)")).toBeNull();
    // and red again
    expect(say("      Tests  1 failed | 6 passed (7)")).toBe("development.test_failed");
  });

  it("tracks the build and the tests independently", () => {
    const t = new OutputTracker();
    expect(t.feed("Found 3 errors in 2 files.")?.type).toBe("development.build_failed");
    expect(t.feed("      Tests  1 failed | 1 passed (2)")?.type).toBe("development.test_failed");
    expect(t.feed(" ✓ Compiled successfully")?.type).toBe("development.build_succeeded");
    expect(t.feed("      Tests  2 passed (2)")?.type).toBe("development.test_passed");
  });

  it("carries the count from the summary line", () => {
    const t = new OutputTracker();
    expect(t.feed("      Tests  4 failed | 1 passed (5)")?.payload).toEqual({ failing: 4 });
    const b = new OutputTracker();
    expect(b.feed("Found 7 errors in 3 files.")?.payload).toEqual({ errors: 7 });
  });

  it("a first-ever green run is not news, a recovery is", () => {
    const fresh = new OutputTracker();
    expect(fresh.feed("      Tests  9 passed (9)")).toBeNull(); // nothing was broken
    expect(fresh.feed("Compiled successfully")).toBeNull();
    const broken = new OutputTracker();
    broken.feed("      Tests  1 failed | 8 passed (9)");
    expect(broken.feed("      Tests  9 passed (9)")?.type).toBe("development.test_passed");
  });

  it("sends every signal as development-sourced, with a sensible severity", () => {
    const t = new OutputTracker();
    const fail = t.feed("      Tests  1 failed | 0 passed (1)")!;
    expect(fail.source).toBe("development");
    expect(fail.severity).toBe("warning");
    const pass = t.feed("      Tests  1 passed (1)")!;
    expect(pass.severity).toBe("info");
  });
});
