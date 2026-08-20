import { describe, it, expect } from "vitest";
import { jsonFromText } from "./http";

describe("jsonFromText", () => {
  it("extracts a fenced json block", () => {
    expect(jsonFromText('here:\n```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("survives stray braces in prose before the real object", () => {
    const text = 'Given the state {problems: 1}, the decision is: {"id":"dec-1","n":2}';
    expect(jsonFromText(text)).toEqual({ id: "dec-1", n: 2 });
  });

  it("handles a top-level array", () => {
    expect(jsonFromText("result: [1,2,3] done")).toEqual([1, 2, 3]);
  });

  it("respects braces inside strings", () => {
    expect(jsonFromText('{"note":"a } b { c","ok":true}')).toEqual({ note: "a } b { c", ok: true });
  });

  it("throws when there is no JSON value", () => {
    expect(() => jsonFromText("no json here")).toThrow();
  });
});
