import { describe, it, expect } from "vitest";
import { relPath, isIgnored, classifyLine, OutputTracker, matterEvent } from "./shape";

describe("desktop agent shaping (privacy)", () => {
  it("sends relative forward-slash paths, never the absolute location", () => {
    const rel = relPath("C:\\Users\\me\\proj", "C:\\Users\\me\\proj\\src\\db.ts");
    expect(rel === "src/db.ts" || rel === "../me/proj/src/db.ts" || rel.endsWith("src/db.ts")).toBe(true);
    expect(rel).not.toContain("\\");
  });
  it("ignores build output, deps, VCS internals, temp and lock files", () => {
    for (const p of ["node_modules/x/y.js", ".git/HEAD", "dist/a.js", ".next/b", "src/.foo.swp", "src/a.ts~", "pnpm-lock.yaml.lock", "../outside.ts", ""]) {
      expect(isIgnored(p)).toBe(true);
    }
    expect(isIgnored("src/db.ts")).toBe(false);
    expect(isIgnored("apps/web/components/Workspace.tsx")).toBe(false);
  });
  it("builds a MatterEvent-shaped payload", () => {
    const e = matterEvent("desktop", "user", "user.opened_file", "debug", { path: "src/db.ts" }, new Date("2026-08-31T00:00:00Z"));
    expect(e.sessionId).toBe("desktop");
    expect(e.timestamp).toBe("2026-08-31T00:00:00.000Z");
    expect(e.payload).toEqual({ path: "src/db.ts" });
  });
});

describe("output classification (summary lines only)", () => {
  it("recognises vitest / jest / mocha / playwright totals", () => {
    expect(classifyLine("      Tests  1 failed | 17 passed (18)")).toBe("test_fail");
    expect(classifyLine("      Tests  18 passed (18)")).toBe("test_pass");
    expect(classifyLine("Tests:       2 failed, 5 passed, 7 total")).toBe("test_fail");
    expect(classifyLine("  3 passing (40ms)")).toBe("test_pass");
    expect(classifyLine("  1 failing")).toBe("test_fail");
    expect(classifyLine("  10 passed (12.5s)")).toBe("test_pass");
    expect(classifyLine(" FAIL  src/shape.test.ts > x")).toBe("test_fail");
  });
  it("recognises tsc / next / vite build results, and compiler errors are build (not test) failures", () => {
    expect(classifyLine("src/a.ts(3,5): error TS2345: Argument of type")).toBe("build_fail");
    expect(classifyLine("Found 2 errors in 1 file.")).toBe("build_fail");
    expect(classifyLine(" ✓ Compiled successfully in 4.2s")).toBe("build_ok");
    expect(classifyLine("✓ built in 812ms")).toBe("build_ok");
    expect(classifyLine("Failed to compile.")).toBe("build_fail");
  });
  it("ignores everything else — no line content ever becomes an event", () => {
    expect(classifyLine("const password = 'hunter2'")).toBeNull();
    expect(classifyLine("GET /users/42 200 12ms")).toBeNull();
    expect(classifyLine("")).toBeNull();
  });
});

describe("OutputTracker (transitions, not lines)", () => {
  it("emits test failure once, stays quiet while still failing, then emits recovery", () => {
    const t = new OutputTracker();
    expect(t.feed("      Tests  2 failed | 5 passed (7)")).toMatchObject({ type: "development.test_failed", payload: { failing: 2 } });
    expect(t.feed("      Tests  2 failed | 5 passed (7)")).toBeNull();
    expect(t.feed("      Tests  7 passed (7)")).toMatchObject({ type: "development.test_passed" });
    expect(t.feed("      Tests  7 passed (7)")).toBeNull();
  });
  it("a first-ever green run is not news; a recovery is", () => {
    const t = new OutputTracker();
    expect(t.feed("      Tests  7 passed (7)")).toBeNull();
    expect(t.feed("Found 3 errors in 2 files.")).toMatchObject({ type: "development.build_failed", payload: { errors: 3 } });
    expect(t.feed("src/b.ts(1,1): error TS1005")).toBeNull(); // still failing
    expect(t.feed(" ✓ Compiled successfully")).toMatchObject({ type: "development.build_succeeded" });
  });
});
