import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The licence boundary, as a test rather than a promise.
 *
 * This repository is MIT. OBS Studio is GPL v2 or later, and so is obs-websocket, the server
 * inside it that `@particle/screen-capture-obs` talks to. Linking GPL code into a build makes the
 * whole of that build GPL, so the two sides are kept in two packages and only one direction of
 * dependency is allowed: the GPL package may use this MIT one, and this MIT one may never reach
 * for the GPL one. Reviewing a licence boundary by reading files is how a boundary rots; this
 * reads them on every run.
 */
const here = dirname(fileURLToPath(import.meta.url));
const mitPackage = join(here, "..");
const obsPackage = join(mitPackage, "..", "screen-capture-obs");
const OBS_PACKAGE_NAME = "@particle/screen-capture-obs";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(dir, e.name));
}

/** Every module this file names in an import, an export-from, a dynamic import or a require. */
function importedModules(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

describe("the MIT side of the capture boundary", () => {
  it("imports nothing from the GPL package, in any file", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(mitPackage, "src"))) {
      for (const specifier of importedModules(readFileSync(file, "utf8"))) {
        if (specifier.includes("screen-capture-obs")) offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("depends on nothing GPL", () => {
    const manifest = JSON.parse(readFileSync(join(mitPackage, "package.json"), "utf8")) as {
      license?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.license).toBe("MIT");
    const named = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(named).not.toContain(OBS_PACKAGE_NAME);
  });

  /** The import graph has to run the other way, and the GPL side has to say what it is. */
  it("is the side the GPL package depends on, and that package says it is GPL", () => {
    const manifest = JSON.parse(readFileSync(join(obsPackage, "package.json"), "utf8")) as {
      license?: string;
      dependencies?: Record<string, string>;
    };
    expect(manifest.license).toBe("GPL-2.0-or-later");
    expect(Object.keys(manifest.dependencies ?? {})).toContain("@particle/screen-capture");
  });

  /** A licence nobody can find is a licence nobody keeps. */
  it("has the GPL text and a notice next to the code it covers", () => {
    const files = readdirSync(obsPackage);
    expect(files).toContain("LICENSE");
    expect(files).toContain("README.md");
    expect(readFileSync(join(obsPackage, "LICENSE"), "utf8")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(readFileSync(join(obsPackage, "README.md"), "utf8")).toContain("GPL-2.0-or-later");
  });
});

describe("the repository around the boundary", () => {
  const root = join(mitPackage, "..", "..");

  /**
   * The point of splitting the packages is that an ordinary build never reaches the GPL one. If
   * an app or another package imported it, the split would be decoration.
   */
  it("has no app or package importing the GPL one", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === ".turbo" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === obsPackage) continue; // the GPL package is allowed to be itself
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) continue;
        if (full.endsWith(join("src", "boundary.test.ts"))) continue; // this file names it on purpose
        for (const specifier of importedModules(readFileSync(full, "utf8"))) {
          if (specifier.includes("screen-capture-obs")) offenders.push(`${full}: ${specifier}`);
        }
      }
    };
    walk(join(root, "apps"));
    walk(join(root, "packages"));
    expect(offenders).toEqual([]);
  });

  /**
   * Reading the import graph catches a file that reaches for the GPL package. It does not catch
   * the manifest that put it there: a `package.json` is not a source file, so a dependency
   * declared in one was invisible here, and installing GPL code into a build is what makes that
   * build GPL whether or not any line imports it yet. Declarations are read too.
   */
  it("has no app or package declaring the GPL one as a dependency", () => {
    const offenders: string[] = [];
    const manifests = [join(root, "package.json")];
    for (const group of ["apps", "packages"]) {
      for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(root, group, entry.name);
        if (dir === obsPackage) continue; // the GPL package is allowed to be itself
        manifests.push(join(dir, "package.json"));
      }
    }
    for (const file of manifests) {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const named of Object.keys(manifest[field] ?? {})) {
          if (named === OBS_PACKAGE_NAME) offenders.push(`${file}: ${field}.${named}`);
        }
      }
    }
    expect(manifests.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
