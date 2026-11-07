import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { t } from "../../lib/i18n";

/**
 * The same guard `lib/i18n.test.ts` keeps over the shell, for the pieces the shell is made of.
 *
 * That one reads `components/Workspace.tsx` by name, so every key that moved out of it when the
 * workspace was split by responsibility would have stopped being checked — and a missing key does
 * not throw, it draws the key itself on screen in Korean.
 */
const HERE = __dirname;

function keysUsedHere(): string[] {
  const src = readdirSync(HERE)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(HERE, f), "utf8"))
    .join("\n");
  return [...new Set([...src.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]!))];
}

describe("workspace chrome keys", () => {
  it("every key the workspace pieces ask for exists in both languages", () => {
    // t() falls back to the key when missing; an en value equal to the key is legit
    // only when the ko value differs (i.e. the key IS the English label).
    const missing = keysUsedHere().filter((k) => t(k, "ko") === k && t(k, "en") === k);
    expect(missing).toEqual([]);
  });

  it("covers the keys that used to live in Workspace.tsx", () => {
    // a split that stopped moving keys here would otherwise make the guard above vacuously true
    expect(keysUsedHere().length).toBeGreaterThan(50);
  });
});
