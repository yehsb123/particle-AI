import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { relPath, isIgnored, branchFromHead, gitDirFrom, matterEvent, healthWarning } from "./shape";

/**
 * The agent watches a directory on someone's own machine, so this is the file that decides what
 * a file save is allowed to say about them. The promise is a path relative to the root they chose
 * and nothing else — never where that root sits on disk, never anything outside it, and never the
 * contents. Each of those is a separate way to break the promise, so each is checked.
 */
const ROOT = resolve("/tmp/particle-project");

describe("a path only ever says where a file sits inside the watched root", () => {
  it("gives a relative, forward-slash path for a file under the root", () => {
    expect(relPath(ROOT, resolve(ROOT, "src/index.ts"))).toBe("src/index.ts");
    expect(relPath(ROOT, resolve(ROOT, "a/b/c/deep.ts"))).toBe("a/b/c/deep.ts");
    expect(relPath(ROOT, resolve(ROOT, "README.md"))).toBe("README.md");
    expect(isIgnored("src/index.ts")).toBe(false);
  });

  it("refuses a path that climbed out of the root", () => {
    expect(isIgnored(relPath(ROOT, resolve(ROOT, "../secrets.txt")))).toBe(true);
    expect(isIgnored("../up.txt")).toBe(true);
    expect(isIgnored("..")).toBe(true);
    expect(isIgnored("../../../etc/passwd")).toBe(true);
  });

  it("refuses an absolute path however it is spelled", () => {
    // path.relative between two Windows drives hands back the absolute target, so a file on
    // another drive would otherwise leave here spelled "D:/somewhere/private.txt"
    for (const rel of ["D:/other-drive/private.txt", "C:/Users/someone/notes.txt", "c:/x", "/etc/passwd", "/Users/someone/.ssh/id_rsa", "\\\\server\\share\\file.txt"]) {
      expect(isIgnored(rel), rel).toBe(true);
    }
  });

  it("refuses an empty path", () => {
    expect(isIgnored("")).toBe(true);
  });
});

describe("what is not worth sensing", () => {
  it("ignores build output, dependencies and VCS internals", () => {
    for (const rel of ["node_modules/react/index.js", "dist/main.js", ".next/static/chunk.js", ".turbo/log", "coverage/lcov.info", "build/out.js", "out/index.html", ".cache/x", "a/b/node_modules/deep.js", ".git/HEAD"]) {
      expect(isIgnored(rel), rel).toBe(true);
    }
  });

  it("ignores a dot directory anywhere in the path, not only a dot file at the end", () => {
    // .ssh, .aws and .vscode are configuration, not work, and the name alone would say what
    // someone was editing
    for (const rel of [".ssh/id_rsa", ".aws/credentials", ".vscode/settings.json", ".config/gcloud/creds.json", "src/.hidden/thing.ts", "a/b/.private/c.ts"]) {
      expect(isIgnored(rel), rel).toBe(true);
    }
  });

  it("ignores editor scratch files and lockfiles", () => {
    for (const rel of ["notes.txt~", "src/index.ts.swp", "build.tmp", "yarn.lock", "src/.env.local", ".env"]) {
      expect(isIgnored(rel), rel).toBe(true);
    }
  });

  it("keeps the ordinary files someone actually works in", () => {
    for (const rel of ["src/index.ts", "README.md", "package.json", "pnpm-lock.yaml", "docs/adr/0001-decision.md", "apps/web/app/page.tsx", "a-file-with.dots.in.it.ts", "Makefile"]) {
      expect(isIgnored(rel), rel).toBe(false);
    }
  });
});

describe("the git branch, and only the branch", () => {
  it("reads the name out of a HEAD written by a checkout", () => {
    expect(branchFromHead("ref: refs/heads/main")).toBe("main");
    expect(branchFromHead("ref: refs/heads/main\n")).toBe("main");
    expect(branchFromHead("  ref:refs/heads/main  ")).toBe("main");
    expect(branchFromHead("ref: refs/heads/feature/DM-12/fix")).toBe("feature/DM-12/fix");
  });

  it("marks a detached head with a short sha", () => {
    expect(branchFromHead("0123456789abcdef0123456789abcdef01234567")).toBe("detached@0123456");
    expect(branchFromHead("0123456")).toBe("detached@0123456");
  });

  it("says nothing for anything else, so nothing is sent", () => {
    for (const text of ["", "   ", "not a head", "012345", "ref: refs/tags/v1.0", "ref: refs/remotes/origin/main", "ref: refs/heads/", "ref:", "xyz1234"]) {
      expect(branchFromHead(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe("finding the git directory", () => {
  const rp = (base: string, p: string) => resolve(base, p);

  it("takes .git when it is a directory", () => {
    expect(gitDirFrom(ROOT, true, undefined, rp)).toBe(resolve(ROOT, ".git"));
  });

  it("follows a worktree's pointer, relative or absolute", () => {
    expect(gitDirFrom(ROOT, false, "gitdir: ../.git/worktrees/wt1\n", rp)).toBe(resolve(ROOT, "../.git/worktrees/wt1"));
    expect(gitDirFrom(ROOT, false, `gitdir: ${resolve("/elsewhere/.git/worktrees/wt1")}`, rp)).toBe(resolve("/elsewhere/.git/worktrees/wt1"));
  });

  it("gives up rather than guessing", () => {
    expect(gitDirFrom(ROOT, false, "this is not a pointer", rp)).toBeNull();
    expect(gitDirFrom(ROOT, false, "", rp)).toBeNull();
    expect(gitDirFrom(ROOT, false, undefined, rp)).toBeNull();
  });
});

describe("the event the agent sends", () => {
  const at = new Date("2026-09-04T00:00:00Z");

  it("carries the shape and nothing more", () => {
    const e = matterEvent("desktop", "user", "user.opened_file", "debug", { path: "src/index.ts" }, at);
    expect(Object.keys(e).sort()).toEqual(["id", "payload", "sessionId", "severity", "source", "timestamp", "type"]);
    expect(e).toMatchObject({ sessionId: "desktop", source: "user", type: "user.opened_file", severity: "debug", payload: { path: "src/index.ts" } });
    expect(e.timestamp).toBe("2026-09-04T00:00:00.000Z");
  });

  it("gives two saves in the same millisecond different ids", () => {
    const a = matterEvent("s", "user", "user.opened_file", "debug", { path: "x" }, at);
    const b = matterEvent("s", "user", "user.opened_file", "debug", { path: "x" }, at);
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("agent-")).toBe(true);
  });

  it("says so once when the runtime is not there, and stays quiet when it is", () => {
    const down = healthWarning("http://localhost:8787", false);
    expect(down).toContain("not reachable");
    expect(down).toContain("http://localhost:8787");
    expect(healthWarning("http://localhost:8787", true)).toBeNull();
  });
});
