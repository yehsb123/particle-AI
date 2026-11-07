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

  it("says the body was empty rather than blaming its shape", () => {
    expect(() => jsonFromText("")).toThrow(/empty/i);
    expect(() => jsonFromText("   \n ")).toThrow(/empty/i);
  });

  it("says how long the prose was and how it began, without quoting all of it", () => {
    const prose = `I am sorry, I cannot help with that. ${"private detail ".repeat(60)}`;
    expect(() => jsonFromText(prose)).toThrow(/I am sorry/);
    expect(() => jsonFromText(prose)).toThrow(new RegExp(String(prose.length)));
    try {
      jsonFromText(prose);
      expect.unreachable("jsonFromText should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("private detail private detail private detail");
      expect(message.length).toBeLessThan(200);
    }
  });
});
