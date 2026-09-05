import { describe, it, expect } from "vitest";
import { gitDirFrom, MAX_PATH } from "./shape";

/**
 * A repository can keep its real git directory somewhere else and leave a `.git` FILE saying
 * where — that is how a worktree works, and the directory it names is normally outside the one
 * being watched, under the main repository.
 *
 * So "inside the watched root" is the wrong rule: it would refuse the case the feature exists
 * for. But the file lives in a directory somebody else may have authored, and it can name any
 * directory at all, including one nobody opted into. What decides is whether a branch can
 * actually be read there — the daemon looks for a HEAD before it watches anything — and what is
 * refused here is a line too long to be a path.
 */
const ROOT = "/home/someone/project";
const join = (base: string, p: string) => (p.startsWith("/") ? p : `${base}/${p}`);

describe("where a .git file may point", () => {
  it("is the directory it names, resolved against the repository", () => {
    expect(gitDirFrom(ROOT, false, "gitdir: ../.git/worktrees/feature", join)).toBe(`${ROOT}/../.git/worktrees/feature`);
  });

  it("is allowed to be outside the watched root, because a worktree is", () => {
    // the rule that would have been easy here is the one that breaks the real case
    const worktree = gitDirFrom(ROOT, false, "gitdir: ../.git/worktrees/feature", join);
    expect(worktree).toBeDefined();
    expect(worktree!.startsWith(`${ROOT}/`)).toBe(true);
    expect(worktree).toContain("..");
  });

  it("is the repository's own .git when that is a directory", () => {
    expect(gitDirFrom(ROOT, true, undefined, join)).toBe(`${ROOT}/.git`);
    // the file is not even read in that case
    expect(gitDirFrom(ROOT, true, "gitdir: /somewhere/else", join)).toBe(`${ROOT}/.git`);
  });

  it("is nothing when the file says nothing this sensor understands", () => {
    for (const text of [undefined, "", "nonsense", "gitdir:", "gitdir:    ", "GITDIR: /x"]) {
      expect(gitDirFrom(ROOT, false, text, join), JSON.stringify(text) ?? "undefined").toBeNull();
    }
  });

  it("is nothing when the line is too long to be a path", () => {
    expect(gitDirFrom(ROOT, false, `gitdir: ${"x".repeat(MAX_PATH + 1)}`, join)).toBeNull();
    expect(gitDirFrom(ROOT, false, `gitdir: ${"x".repeat(50_000)}`, join)).toBeNull();
  });

  it("still takes a path as long as one really gets", () => {
    const long = "x".repeat(MAX_PATH);
    expect(gitDirFrom(ROOT, false, `gitdir: ${long}`, join)).toBe(`${ROOT}/${long}`);
  });

  it("reads the first gitdir line, wherever in the file it is", () => {
    expect(gitDirFrom(ROOT, false, "# a comment\ngitdir: ../elsewhere\n", join)).toBe(`${ROOT}/../elsewhere`);
  });
});
