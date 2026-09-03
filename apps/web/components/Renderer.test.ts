import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIComponent } from "@particle/contracts";
import { Render, RendererProvider, type RendererCtx } from "./Renderer";
import { developmentBlueprint, incidentPatch, augmentPatch } from "@particle/ui-registry";
import { applyPatch } from "@particle/morph-engine";

/**
 * The renderer is the last line between validated data and the screen. These tests render real
 * blueprints/patches to static markup — no browser needed — and pin the properties the E2E suite
 * can only observe indirectly: malformed props never throw, unknown component types degrade to a
 * container instead of a blank screen, content is translated, generated sentences use templates,
 * and unsaved work is marked.
 */
const ctx = (over: Partial<RendererCtx> = {}): RendererCtx => ({
  emitAction: () => {},
  setFocus: () => {},
  clearFocus: () => {},
  tr: (s) => s,
  ...over,
});

function html(node: UIComponent, c: RendererCtx = ctx()): string {
  return renderToStaticMarkup(createElement(RendererProvider, { value: c, children: createElement(Render, { node }) }));
}

describe("Renderer — real blueprints", () => {
  it("renders the development workspace with the editor and its unsaved marker", () => {
    const out = html(developmentBlueprint("t").root);
    expect(out).toContain("src/routes.ts");
    expect(out).toContain("unsaved"); // volatile component is marked, so a morph can protect it
    expect(out).toContain("Development status");
  });

  it("renders every incident kind without throwing, keeping the editor beside the incident", () => {
    for (const kind of ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"] as const) {
      const patch = incidentPatch("d", kind);
      const { next } = applyPatch(developmentBlueprint("t"), patch, "2026-08-31T00:00:00Z");
      const out = html(next.root);
      expect(out).toContain("src/routes.ts"); // unsaved work survives the morph
      expect(out.length).toBeGreaterThan(500);
    }
  });

  it("renders the behaviour cards (returning / stuck / switching)", () => {
    for (const kind of ["returning", "stuck", "switching"] as const) {
      const { next } = applyPatch(developmentBlueprint("t"), augmentPatch("d", kind), "2026-08-31T00:00:00Z");
      expect(html(next.root)).toContain("Dismiss");
    }
  });
});

describe("Renderer — defensive rendering (invalid props can never break the body)", () => {
  const bad = (type: string, props: Record<string, unknown>): UIComponent => ({ id: `x-${type}`, type: type as UIComponent["type"], props });

  it("survives wrong-typed props on every prop-driven component", () => {
    const cases: UIComponent[] = [
      bad("Grid", { columns: "not a number" }),
      bad("SplitPane", { ratio: null }),
      bad("Table", { columns: "nope", rows: 42 }),
      bad("Timeline", { items: "nope" }),
      bad("LogViewer", { lines: { not: "an array" } }),
      bad("Progress", { value: "abc" }),
      bad("Tree", { nodes: 7 }),
      bad("Metric", { value: undefined, label: null }),
    ];
    for (const node of cases) {
      const out = html(node);
      expect(out).toContain(`data-id="${node.id}"`);
      expect(out).not.toContain("NaN"); // numeric coercion, never NaN in layout math
    }
  });

  it("degrades an unknown component type to a labelled container instead of a blank screen", () => {
    const out = html({ id: "u1", type: "SomethingNotInTheRegistry" as UIComponent["type"], props: {}, children: [{ id: "k", type: "Badge", props: { text: "inside" } }] });
    expect(out).toContain("SomethingNotInTheRegistry");
    expect(out).toContain("inside"); // children still render
  });

  it("renders a deeply nested tree without stack issues", () => {
    let node: UIComponent = { id: "leaf", type: "Badge", props: { text: "deep" } };
    for (let i = 0; i < 60; i++) node = { id: `n${i}`, type: "Stack", props: {}, children: [node] };
    expect(html(node)).toContain("deep");
  });
});

describe("Renderer — content translation and templates", () => {
  it("routes every content string through tr(), so Korean mode translates the body too", () => {
    const seen: string[] = [];
    const out = html(
      { id: "p", type: "Panel", props: { title: "Runtime incident", badge: "CRITICAL" }, children: [{ id: "b", type: "Badge", props: { text: "recurring" } }] },
      ctx({ tr: (s) => { seen.push(s); return s === "Runtime incident" ? "런타임 인시던트" : s; } }),
    );
    expect(seen).toContain("Runtime incident");
    expect(seen).toContain("CRITICAL");
    expect(out).toContain("런타임 인시던트");
  });

  it("fills a bound template (id + params) in the viewer's language, falling back to text", () => {
    const node: UIComponent = { id: "m", type: "Markdown", props: { text: "English fallback", tpl: { id: "tpl_calm", params: { files: "a, b" } } } };
    const filled = html(node, ctx({ tpl: (id, params) => `${id}:${String(params.files)}` }));
    expect(filled).toContain("tpl_calm:a, b");
    expect(filled).not.toContain("English fallback");
    // no tpl handler (or no template on the node) → the plain text is used
    expect(html(node)).toContain("English fallback");
    expect(html({ id: "m2", type: "Markdown", props: { text: "plain" } }, ctx({ tpl: () => "should not be used" }))).toContain("plain");
  });

  it("renders table rows through tr() so bound capability output is translated too", () => {
    const out = html(
      { id: "t", type: "Table", props: { title: "Failing hosts", columns: ["Host", "State"], rows: [["api.example.com", "failing"]] } },
      ctx({ tr: (s) => (s === "failing" ? "실패 중" : s) }),
    );
    expect(out).toContain("api.example.com");
    expect(out).toContain("실패 중");
  });
});
