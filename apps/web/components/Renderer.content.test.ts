import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIComponent } from "@particle/contracts";
import { Render, RendererProvider, MAX_TEXT, MAX_ITEMS, type RendererCtx } from "./Renderer";

/**
 * The other half of hostile props: not the wrong kind, but the wrong size and the wrong content.
 *
 * Props are written by the model and checked for their shape, never their size. A label of a
 * million characters passed the gate and rendered whole; a list prop of twenty thousand entries
 * rendered every one. Neither is something a person reads, and both are something a tab stops
 * responding to. An escape sequence in a label is invisible where it lands and active wherever
 * the text is carried next.
 *
 * The newline and the tab stay: a Markdown block renders pre-wrap, and flattening it would take
 * the shape out of the one component whose shape is its content.
 */
const ctx: RendererCtx = { emitAction: () => {}, setFocus: () => {}, clearFocus: () => {}, tr: (s) => s, tpl: (id) => id };
const draw = (node: UIComponent) =>
  renderToStaticMarkup(createElement(RendererProvider, { value: ctx, children: createElement(Render, { node }) }));
const node = (type: string, props: Record<string, unknown>): UIComponent => ({ id: "n", type, props } as UIComponent);

const HUGE = "a".repeat(1_000_000);

describe("a value too long to read", () => {
  const shownAs: [string, string][] = [
    ["Text", "text"],
    ["Heading", "text"],
    ["Metric", "value"],
    ["Alert", "text"],
    ["Badge", "text"],
    ["CodeEditor", "value"],
    ["DiffViewer", "diff"],
    ["Markdown", "text"],
  ];

  it("is cut, whichever component shows it", () => {
    for (const [type, prop] of shownAs) {
      const html = draw(node(type, { [prop]: HUGE }));
      expect(html.length, type).toBeLessThan(MAX_TEXT + 1_000);
    }
  });

  it("says it was cut", () => {
    expect(draw(node("Text", { text: HUGE }))).toContain("…");
  });

  it("is left alone when it fits", () => {
    const fits = "b".repeat(MAX_TEXT);
    expect(draw(node("Text", { text: fits }))).toContain(fits);
    expect(draw(node("Text", { text: fits }))).not.toContain("…");
  });

  it("cannot be made long again through JSON", () => {
    const html = draw(node("JSONViewer", { data: { big: HUGE } }));
    expect(html.length).toBeLessThan(MAX_TEXT + 1_000);
  });
});

describe("a list too long to read", () => {
  it("is cut, whichever component walks it", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => `entry ${i}`);
    for (const [type, prop] of [["LogViewer", "lines"], ["ActivityFeed", "items"], ["FileExplorer", "items"]] as [string, string][]) {
      const html = draw(node(type, { [prop]: many }));
      expect(html, type).toContain("entry 0");
      expect(html, type).not.toContain(`entry ${MAX_ITEMS + 10}`);
    }
  });

  it("is left alone when it fits", () => {
    const few = Array.from({ length: 10 }, (_, i) => `entry ${i}`);
    const html = draw(node("LogViewer", { lines: few }));
    for (const line of few) expect(html).toContain(line);
  });
});

describe("a value carrying characters that are not text", () => {
  it("shows none of them", () => {
    for (let code = 0; code < 0xa0; code += 1) {
      if (code >= 0x20 && code < 0x7f) continue;
      if (code === 0x0a || code === 0x09) continue; // newline and tab are whitespace, not noise
      const char = String.fromCharCode(code);
      const html = draw(node("Text", { text: `a${char}b` }));
      expect(html.includes(char), `U+${code.toString(16)}`).toBe(false);
      expect(html, `U+${code.toString(16)}`).toContain("ab");
    }
  });

  it("keeps the newline and the tab a pre-wrap block needs", () => {
    const html = draw(node("Markdown", { text: "first\nsecond\tthird" }));
    expect(html).toContain("first\nsecond\tthird");
  });

  it("still escapes what a browser would read as markup", () => {
    const html = draw(node("Text", { text: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("a prop that is an object where text was expected", () => {
  it("shows nothing rather than emptying the body", () => {
    // React refuses an object as a child: this used to throw, and a throw in this tree takes the
    // whole interface down rather than one card
    for (const [type, prop] of [["Metric", "value"], ["Text", "text"], ["CodeEditor", "value"], ["DiffViewer", "diff"]] as [string, string][]) {
      expect(() => draw(node(type, { [prop]: { a: 1 } })), type).not.toThrow();
      expect(draw(node(type, { [prop]: { a: 1 } })), type).not.toContain("[object Object]");
    }
  });

  it("shows a structure that refers to itself as unshowable, rather than throwing", () => {
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    expect(() => draw(node("JSONViewer", { data: circular }))).not.toThrow();
    expect(draw(node("JSONViewer", { data: circular }))).toContain("cannot be shown");
  });

  it("still shows a structure it can", () => {
    expect(draw(node("JSONViewer", { data: { host: "api.example.com" } }))).toContain("api.example.com");
  });
});
