import { describe, it, expect } from "vitest";
import { t, tr, fillTemplate, type Lang } from "./i18n";

/**
 * Every string on the screen comes through these three functions, and the model chooses many of
 * them: a component's text is whatever the blueprint says. So each one is a lookup keyed by
 * untrusted input, and the thing that matters is that a key nobody put in the table comes back
 * out unchanged — as a string, in both languages.
 */
const PROTOTYPE_KEYS = ["toString", "constructor", "__proto__", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"];

describe("tr — translating what a blueprint says", () => {
  it("translates a string it knows, and leaves English alone", () => {
    expect(tr("Workspace", "ko")).toBe("워크스페이스");
    expect(tr("Workspace", "en")).toBe("Workspace");
  });

  it("passes an unknown string through, which is how code and logs survive", () => {
    for (const s of ["GET /users/42 → 500", "db.users", "some log line", "42", ""]) {
      expect(tr(s, "ko"), s).toBe(s);
      expect(tr(s, "en"), s).toBe(s);
    }
  });

  it("hands back a string for a key that belongs to every object", () => {
    // it used to hand back a FUNCTION, which React refuses to render — the whole screen went
    // down because a component's text happened to be "constructor"
    for (const key of PROTOTYPE_KEYS) {
      expect(typeof tr(key, "ko"), key).toBe("string");
      expect(tr(key, "ko"), key).toBe(key);
      expect(typeof tr(key, "en"), key).toBe("string");
    }
  });

  it("never returns something that cannot be shown", () => {
    for (const lang of ["en", "ko"] as Lang[]) {
      for (const s of [...PROTOTYPE_KEYS, "Workspace", "unknown", "{n}", "0", "false"]) {
        const out = tr(s, lang);
        expect(typeof out, `${lang}:${s}`).toBe("string");
        expect(out.length, `${lang}:${s}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("t — the chrome the shell draws itself with", () => {
  it("gives the label in the language asked for", () => {
    expect(t("undo", "en")).toBe("Undo last morph");
    expect(t("undo", "ko")).toBe("마지막 변형 취소");
  });

  it("falls back to the key when nobody wrote that label", () => {
    expect(t("no-such-key", "en")).toBe("no-such-key");
    expect(t("no-such-key", "ko")).toBe("no-such-key");
    expect(t("", "ko")).toBe("");
  });

  it("does not treat a property of every object as a label", () => {
    for (const key of PROTOTYPE_KEYS) {
      expect(t(key, "ko"), key).toBe(key);
      expect(typeof t(key, "en"), key).toBe("string");
    }
  });
});

describe("fillTemplate — sentences the runtime generates", () => {
  it("fills the slots it was given, in order, repeatedly", () => {
    expect(fillTemplate("{n} open problem(s): {list}.", { n: 2, list: "a, b" })).toBe("2 open problem(s): a, b.");
    expect(fillTemplate("{a}{b}{a}", { a: "x", b: "y" })).toBe("xyx");
  });

  it("leaves a slot visible when the param is missing, so nobody hides a gap", () => {
    expect(fillTemplate("{missing} here", {})).toBe("{missing} here");
    expect(fillTemplate("{n} and {m}", { n: 1 })).toBe("1 and {m}");
    expect(fillTemplate("{n}", {})).toBe("{n}");
  });

  it("leaves a slot visible when the param is there but has no value", () => {
    // "undefined" printed in a sentence someone reads is worse than an unfilled slot
    expect(fillTemplate("{n} open", { n: undefined })).toBe("{n} open");
  });

  it("does not fill a slot named after a property of every object", () => {
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      expect(fillTemplate(`{${key}} here`, {}), key).toBe(`{${key}} here`);
      expect(fillTemplate(`{${key}}`, {}), key).not.toContain("native code");
    }
  });

  it("prints a real value, even a falsy one", () => {
    expect(fillTemplate("{n}", { n: 0 })).toBe("0");
    expect(fillTemplate("{n}", { n: false })).toBe("false");
    expect(fillTemplate("{n}", { n: null })).toBe("null");
    expect(fillTemplate("{n}", { n: "" })).toBe("");
  });

  it("leaves text with no slots exactly as it is", () => {
    for (const text of ["plain sentence", "", "a { b } c", "100% done", "{}", "{ n }", "{n-1}"]) {
      expect(fillTemplate(text, { n: 1 }), text).toBe(text);
    }
  });

  it("works with no params at all", () => {
    expect(fillTemplate("{n} open")).toBe("{n} open");
    expect(fillTemplate("plain")).toBe("plain");
  });

  it("never returns anything but a string", () => {
    for (const [text, params] of [["{a}", { a: { deep: true } }], ["{a}", { a: [1, 2] }], ["{a}", { a: 1.5 }]] as [string, Record<string, unknown>][]) {
      expect(typeof fillTemplate(text, params)).toBe("string");
    }
    expect(fillTemplate("{a}", { a: [1, 2] })).toBe("1,2");
  });
});
