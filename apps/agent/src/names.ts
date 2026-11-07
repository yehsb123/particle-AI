/**
 * Particle AI desktop agent — the names and paths this sensor is allowed to say.
 *
 * Everything here turns something observed on this machine into a bounded, printable name: a
 * relative path, a branch, a window title. Nothing here reaches the network; what is built out of
 * these and handed over lives in `shape.ts`, which is still the one file to read for that.
 *
 * Like the rest of the agent this module takes no dependency on the monorepo on purpose —
 * somebody runs this on their own machine, and what it can do should be readable where it is.
 */
import { relative, sep } from "node:path";

/** Directories that are noise for intent (build output, deps, VCS internals). */
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "coverage", ".cache", "build", "out"]);

/** Relative, forward-slash path — never the absolute location on disk. */
export function relPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/").replace(/\\/g, "/");
}

/** A path that is not plainly relative to the watched root: absolute, rooted, or climbing out. */
function escapesRoot(rel: string): boolean {
  // `path.relative` between two different Windows drives hands back the absolute target, so a
  // file on another drive would otherwise leave here spelled "D:/somewhere/private.txt".
  return rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\") || /^[a-zA-Z]:/.test(rel);
}

export function isIgnored(rel: string): boolean {
  if (!rel || escapesRoot(rel)) return true;
  const parts = rel.split("/");
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  // A dot directory anywhere in the path is configuration, not work — .ssh, .aws and .vscode
  // are nobody's business, and the name alone would say what someone was editing.
  if (parts.some((p) => p.startsWith("."))) return true;
  const base = parts[parts.length - 1] ?? "";
  // editor temp/swap files and lockfiles are not "the user working on something"
  return base.endsWith("~") || base.endsWith(".swp") || base.endsWith(".tmp") || base.endsWith(".lock");
}

/**
 * Branch name from the text of `.git/HEAD` — "ref: refs/heads/main" → "main"; a detached HEAD
 * becomes "detached@<short sha>". Anything else is undefined (never sent).
 */
/**
 * How much of a name this sensor will send. The same bound the runtime keeps (MAX_IDENTIFIER in
 * the contracts, asserted by this package's tests): a sensor sends a shape, and a shape has a
 * size. Trimming here as well as there means what leaves this machine is already a shape, rather
 * than something the receiver has to cut down after it has already been sent.
 */
export const MAX_NAME = 120;

/** Control characters: a name carrying an escape sequence is read by a terminal, not a person. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * A name this machine observed, made fit to send and to print.
 *
 * These come from outside: a branch name out of a file git wrote, a path out of the OS watcher, a
 * host out of a URL. None of them are bounded at the source, and a name is written into an event,
 * into cards someone reads, and into this process's own stderr — where an escape sequence is an
 * instruction to their terminal rather than a name anybody chose.
 */
export function identifier(name: unknown): string {
  if (typeof name !== "string") return "";
  const clean = name.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE, " ").trim();
  return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME)}…` : clean;
}

export function branchFromHead(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.trim();
  if (!t) return undefined;
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t);
  // a branch name is whatever git was told to call it, and .git/HEAD is a file like any other
  if (ref?.[1]) return identifier(ref[1]) || undefined;
  return /^[0-9a-f]{7,40}$/i.test(t) ? `detached@${t.slice(0, 7)}` : undefined;
}

/**
 * How long a path this sensor will follow. Every operating system stops well before this; a line
 * longer than it is not a path somebody wrote.
 */
export const MAX_PATH = 4_096;

/**
 * Resolve the git directory for a root: `.git` as a directory, or a worktree's `gitdir:` file.
 *
 * The file is written by git but lives in a directory somebody else may have authored, and it can
 * name any directory at all. Pointing outside the watched root is not itself wrong — that is what
 * a worktree does, since git keeps the real directory under the main repository — so the caller
 * is what decides whether to follow it, by looking for a HEAD there before watching anything.
 * What is refused here is a line too long to be a path.
 */
export function gitDirFrom(root: string, dotGitIsDir: boolean, dotGitText: string | undefined, resolvePath: (base: string, p: string) => string): string | null {
  if (dotGitIsDir) return resolvePath(root, ".git");
  const m = /^gitdir:\s*(.+)$/m.exec(dotGitText ?? "");
  const named = m?.[1]?.trim();
  if (!named || named.length > MAX_PATH) return null;
  return resolvePath(root, named);
}
