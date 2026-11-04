import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPONENT_TYPES, type UIComponent } from "@particle/contracts";
import { MAX_ITEMS, Render, RendererProvider, type RendererCtx } from "./Renderer";

/**
 * The renderer is the last thing between validated data and the screen, and "validated" only
 * covers the shape of the tree: a component's props are whatever the model put there, and a data
 * binding can drop a capability's output straight into one. So a prop of the wrong kind must not
 * take the interface down — a thrown error in this tree blanks the whole body, not one card.
 */
const ctx: RendererCtx = {
  emitAction: () => {},
  setFocus: () => {},
  clearFocus: () => {},
  tr: (s) => s,
  tpl: (id) => id,
};

const render = (node: UIComponent) =>
  renderToStaticMarkup(createElement(RendererProvider, { value: ctx, children: createElement(Render, { node }) }));

/** Props of every shape a component might read, all of them wrong. */
const HOSTILE: Record<string, unknown>[] = [
  {},
  { text: 42, title: {}, value: "not a number", label: [], badge: {}, tone: 7, level: "big", placeholder: 0 },
  { text: null, title: null, value: null, rows: null, items: null, lines: null, nodes: null, entries: null },
  { rows: [null, 42, "x", {}], columns: [null, {}], items: [undefined, 1], lines: [null, {}], data: ["a", 2], entries: [null, { k: 1 }], nodes: [null, { label: {} }], options: [null, 3], panels: [null] },
  { rows: [[null, undefined]], items: [{ time: {}, label: [] }], nodes: [{ label: 1, children: [null] }] },
  { text: "x".repeat(3000), rows: Array.from({ length: 200 }, () => ["a", "b"]) },
  // A bare object in a prop that is shown rather than walked. Every fixture above put an object
  // in `title` and `badge` but never in `value` or `data`, and those two are read by helpers that
  // did not check: React refuses an object as a child, and that empties the body rather than one
  // card. This is the shape the list above was meant to have all along.
  { value: { a: 1 }, data: { a: 1 }, diff: { a: 1 }, placeholder: { a: 1 } },
  { value: [1, 2], data: [1, 2], diff: [1, 2], placeholder: [1, 2] },
  { value: () => 1, data: () => 1, diff: () => 1 },
];

/** A structure that refers to itself: JSON.stringify throws on one, and a prop can hold one. */
const circular = (): Record<string, unknown> => {
  const o: Record<string, unknown> = { name: "x" };
  o.self = o;
  return o;
};
HOSTILE.push({ value: circular(), data: circular(), diff: circular() });

afterEach(() => vi.restoreAllMocks());

/** A label for a fixture. The fixtures include one that refers to itself, so this cannot use
 *  JSON.stringify: naming the case must not be the thing that throws. */
const label = (props: Record<string, unknown>, i: number): string => `#${i} {${Object.keys(props).join(",")}}`;

describe("every component type survives a prop of the wrong kind", () => {
  it("renders all of them without throwing", () => {
    for (const type of COMPONENT_TYPES) {
      for (const [i, props] of HOSTILE.entries()) {
        const node = { id: "n", type, props, children: [{ id: "c", type: "Text", props: { text: "child" } }] } as UIComponent;
        expect(() => render(node), `${type} ${label(props, i)}`).not.toThrow();
      }
    }
  });

  it("never puts an object, NaN or undefined on the screen", () => {
    for (const type of COMPONENT_TYPES) {
      for (const props of HOSTILE) {
        const html = render({ id: "n", type, props } as UIComponent);
        expect(html, `${type}`).not.toContain("[object Object]");
        expect(html, `${type}`).not.toContain("NaN");
        expect(html, `${type}`).not.toContain("undefined");
      }
    }
  });

  it("renders each of them quietly — no warning about a list without keys", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const type of COMPONENT_TYPES) {
      for (const props of HOSTILE) render({ id: "n", type, props } as UIComponent);
    }
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("key"))).toEqual([]);
  });

  it("escapes anything that looks like markup", () => {
    for (const type of COMPONENT_TYPES) {
      const html = render({ id: "n", type, props: { text: "<script>alert(1)</script>", title: "<img onerror=x>", label: "</div>" } } as UIComponent);
      expect(html, type).not.toContain("<script>alert(1)</script>");
      expect(html, type).not.toContain("<img onerror=x>");
    }
  });
});

describe("the shapes that used to take the body down", () => {
  it("shows a table row that is not a row, rather than throwing over it", () => {
    const html = render({ id: "n", type: "Table", props: { columns: ["a"], rows: [null, 42, "text", {}, ["real", "row"]] } } as UIComponent);
    expect(html).toContain("real");
    expect(html).toContain("42");
    expect(html).not.toContain("[object Object]");
  });

  it("shows a timeline entry that is not an entry", () => {
    const html = render({ id: "n", type: "Timeline", props: { items: [undefined, 1, { time: "10:00", label: "real" }] } } as UIComponent);
    expect(html).toContain("10:00");
    expect(html).toContain("real");
  });

  it("shows a tree of nodes that are not nodes", () => {
    const html = render({ id: "n", type: "Tree", props: { nodes: [null, { label: "real", children: [null, { label: "deep" }] }] } } as UIComponent);
    expect(html).toContain("real");
    expect(html).toContain("deep");
  });

  it("shows inspector entries that are half missing", () => {
    const html = render({ id: "n", type: "Inspector", props: { entries: [null, { k: "key" }, { v: "value" }] } } as UIComponent);
    expect(html).toContain("key");
    expect(html).toContain("value");
  });

  it("keeps the real values when only some of them are wrong", () => {
    const html = render({ id: "n", type: "LogViewer", props: { lines: [null, "a real line", {}, 42] } } as UIComponent);
    expect(html).toContain("a real line");
    expect(html).toContain("42");
  });
});

describe("what a component with nothing to show does", () => {
  it("still renders itself, so the layout does not collapse", () => {
    for (const type of COMPONENT_TYPES) {
      const html = render({ id: "empty", type, props: {} } as UIComponent);
      expect(html.length, type).toBeGreaterThan(0);
      expect(html, type).toContain('data-id="empty"');
    }
  });
});

/**
 * Two shapes the renderer still took at its word.
 *
 * A tab's label was cast, not read: every sibling path goes through `text`, and this one put the
 * prop straight into the tree. Props are whatever the model wrote, and a data binding drops a
 * capability's output into one — an object there is a child React refuses, which empties the
 * whole body, not the tab strip.
 *
 * A tree's `nodes` prop was walked with no floor. Only the top list was bounded; each child list
 * went straight back in, so a deeply nested prop ran the renderer out of stack mid-render, which
 * empties the body the same way.
 */
const deepNodes = (depth: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { label: "bottom" };
  for (let i = 0; i < depth; i++) node = { label: `n${i}`, children: [node] };
  return node;
};

describe("a prop that is not text where text was assumed", () => {
  it("shows a tab whose title is an object as a tab, not as a blank body", () => {
    const tabs = {
      id: "n",
      type: "Tabs",
      props: {},
      children: [
        { id: "a", type: "Text", props: { title: { a: 1 }, text: "first" } },
        { id: "b", type: "Text", props: { title: "Named", text: "second" } },
      ],
    } as unknown as UIComponent;
    const html = render(tabs);
    expect(html).toContain("Named");
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("Tab 1"); // the one with no usable title falls back, like everywhere else
  });

  it("shows a tab title that is a number, an array or a function without taking the body down", () => {
    for (const title of [42, [1, 2], () => "x", null, { a: 1 }]) {
      const node = {
        id: "n",
        type: "Tabs",
        props: {},
        children: [{ id: "a", type: "Text", props: { title, text: "body" } }],
      } as unknown as UIComponent;
      expect(() => render(node), String(typeof title)).not.toThrow();
      expect(render(node)).not.toContain("[object Object]");
    }
  });
});

describe("a tree prop nested deeper than anybody reads", () => {
  it("stops at a depth a person could read, instead of walking all of it", () => {
    const node = { id: "n", type: "Tree", props: { nodes: [deepNodes(2_000)] } } as unknown as UIComponent;
    let html = "";
    expect(() => { html = render(node); }).not.toThrow();
    expect(html).toContain("n1999"); // the top of the prop is still shown
    expect(html).not.toContain("bottom"); // two thousand levels down is not a tree, it is a weapon
  });

  it("still shows the levels a person would actually read", () => {
    const html = render({ id: "n", type: "Tree", props: { nodes: [deepNodes(5)] } } as unknown as UIComponent);
    expect(html).toContain("n4");
    expect(html).toContain("bottom");
  });

  it("bounds how wide one level may be, like every other list prop", () => {
    const wide = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ label: `w${i}` }));
    const html = render({ id: "n", type: "Tree", props: { nodes: [{ label: "top", children: wide }] } } as unknown as UIComponent);
    expect(html).toContain("w0");
    expect(html).not.toContain(`w${MAX_ITEMS + 10}`);
  });

  it("does not walk a children prop that is not a list", () => {
    const html = render({ id: "n", type: "Tree", props: { nodes: [{ label: "top", children: "not a list" }] } } as unknown as UIComponent);
    expect(html).toContain("top");
    expect(html).not.toContain("not a list");
  });
});
