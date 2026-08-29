import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { t, tr } from "./i18n";
import { developmentBlueprint, incidentPatch, type IncidentKind } from "@particle/ui-registry";
import type { UIComponent } from "@particle/contracts";

/**
 * i18n consistency audit (regression guard):
 * (a) every t("key") used in the React shell must exist in the chrome dictionary
 *     (t() returns the key itself when missing — Korean must never show a raw key);
 * (b) every human-facing string in the blueprints must have a Korean translation,
 *     except code/log/diff/identifier content which intentionally stays verbatim.
 */

const WEB = join(__dirname, "..");

function chromeKeysUsed(): string[] {
  const src = ["components/Workspace.tsx", "components/DeveloperInspector.tsx"]
    .map((f) => readFileSync(join(WEB, f), "utf8"))
    .join("\n");
  const keys = [...src.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]!);
  keys.push("observing", "evaluating", "acting", "waiting_for_approval", "idle"); // presence
  return [...new Set(keys)];
}

function blueprintStrings(): Set<string> {
  const shown = new Set<string>();
  const walk = (n: UIComponent): void => {
    const p = (n.props ?? {}) as Record<string, unknown>;
    for (const k of ["title", "text", "label", "badge"]) {
      if (typeof p[k] === "string") shown.add(p[k] as string);
    }
    if (Array.isArray(p.items)) {
      for (const it of p.items as { label?: string }[]) if (it?.label) shown.add(it.label);
    }
    if (Array.isArray(p.columns)) for (const c of p.columns as string[]) shown.add(String(c));
    if (Array.isArray(p.rows)) for (const r of p.rows as string[][]) for (const c of r) shown.add(String(c));
    for (const c of n.children ?? []) walk(c);
  };
  walk(developmentBlueprint("t").root);
  for (const kind of ["runtime_error", "build_failure", "test_failure"] as IncidentKind[]) {
    for (const op of incidentPatch("d", kind).operations) {
      if (op.op === "add") walk(op.component);
    }
  }
  return shown;
}

// content that intentionally stays verbatim: code, logs, diffs, paths, identifiers, advisories
const VERBATIM =
  /^(src\/|package\.json|GET |[-+] |T\+|\d|confidence \d|export |API$|DB$|CVE-|[a-z0-9@][\w-]*[.@/][\w.@/-]*$)/;

describe("i18n consistency", () => {
  it("every chrome key used by the shell exists in both languages", () => {
    const missing = chromeKeysUsed().filter((k) => {
      // t() falls back to the key when missing; an en value equal to the key is legit
      // only when the ko value differs (i.e. the key IS the English label).
      return t(k, "ko") === k && t(k, "en") === k;
    });
    expect(missing).toEqual([]);
  });

  it("every human-facing blueprint string has a Korean translation", () => {
    const untranslated = [...blueprintStrings()].filter(
      (s) => !VERBATIM.test(s) && /[A-Za-z]/.test(s) && tr(s, "ko") === s,
    );
    expect(untranslated).toEqual([]);
  });
});
