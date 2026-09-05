import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UI_SCHEMA_VERSION, type UIComponent } from "@particle/contracts";
import { parseBlueprint } from "./runtimeClient";
import { Render, RendererProvider, type RendererCtx } from "../components/Renderer";

/**
 * When the body connects, it asks the runtime what this session already looks like and draws the
 * answer — before any event arrives. That answer used to be cast straight into the renderer, past
 * the one gate the blueprint schema exists to stand in front of. The schema pins its version on
 * purpose: a blueprint written by another build is to be refused rather than drawn under this
 * build's assumptions. And an answer that is not a blueprint at all is not an empty body — the
 * renderer reads the root of whatever it is handed, so an error body took the whole interface
 * down rather than showing nothing.
 */
const ctx: RendererCtx = { emitAction: () => {}, setFocus: () => {}, clearFocus: () => {}, tr: (s) => s, tpl: (id) => id };
const draw = (node: UIComponent) =>
  renderToStaticMarkup(createElement(RendererProvider, { value: ctx, children: createElement(Render, { node }) }));

const BLUEPRINT = {
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "w",
  mode: "development",
  root: {
    id: "root",
    type: "Panel",
    props: { title: "Files" },
    children: [{ id: "editor", type: "Text", props: { text: "src/routes.ts" }, volatile: true }],
  },
  metadata: { generatedAt: "2026-09-05T00:00:00Z", decisionId: "d1", confidence: 0.9 },
};

describe("the body the runtime already has", () => {
  it("is taken when it is one", () => {
    const parsed = parseBlueprint(BLUEPRINT);
    expect(parsed).not.toBeNull();
    expect(parsed?.root.id).toBe("root");
    expect(parsed?.mode).toBe("development");
  });

  it("is nothing when the answer is not a body at all", () => {
    for (const junk of [null, undefined, 42, "no session", [], true, {}, { error: "unknown session" }]) {
      expect(parseBlueprint(junk), JSON.stringify(junk) ?? "undefined").toBeNull();
    }
  });

  it("is nothing when it has no root to draw", () => {
    for (const root of [undefined, null, "root", 7, {}, { id: "r" }, { type: "panel" }]) {
      expect(parseBlueprint({ ...BLUEPRINT, root }), JSON.stringify(root) ?? "undefined").toBeNull();
    }
  });

  it("is refused when another build wrote it", () => {
    // the version is pinned so a blueprint from a build that knew a different registry is never
    // drawn under this one's assumptions
    for (const version of ["2.0.0", "0.9.0", 1, undefined, null]) {
      expect(parseBlueprint({ ...BLUEPRINT, schemaVersion: version }), String(version)).toBeNull();
    }
    expect(parseBlueprint(BLUEPRINT)).not.toBeNull();
  });

  it("is refused when two components share an id", () => {
    // morphing addresses components by id; a duplicate makes every later patch ambiguous
    const root = { id: "root", type: "Panel", props: {}, children: [{ id: "root", type: "Panel", props: {} }] };
    expect(parseBlueprint({ ...BLUEPRINT, root })).toBeNull();
  });

  it("is refused when it names a component this build does not have", () => {
    const root = { id: "root", type: "Wormhole", props: {} };
    expect(parseBlueprint({ ...BLUEPRINT, root })).toBeNull();
  });

  it("is refused when what it says about itself is not true", () => {
    for (const [field, value] of [
      ["workspaceId", ""],
      ["mode", ""],
      ["metadata", { generatedAt: "yesterday", decisionId: "d", confidence: 0.5 }],
      ["metadata", { generatedAt: "2026-09-05T00:00:00Z", decisionId: "", confidence: 0.5 }],
      ["metadata", { generatedAt: "2026-09-05T00:00:00Z", decisionId: "d", confidence: 7 }],
      ["metadata", undefined],
    ] as [string, unknown][]) {
      expect(parseBlueprint({ ...BLUEPRINT, [field]: value }), `${field}=${JSON.stringify(value)}`).toBeNull();
    }
  });
});

describe("what the renderer is handed", () => {
  it("draws when the gate let it through", () => {
    const parsed = parseBlueprint(BLUEPRINT)!;
    expect(draw(parsed.root).length).toBeGreaterThan(0);
    expect(draw(parsed.root)).toContain("src/routes.ts");
  });

  it("is never the root of something that has none", () => {
    // this is the whole point: reading .props off undefined throws inside the render, and a throw
    // in this tree blanks the body rather than one card
    for (const junk of [null, undefined, 42, "no session", {}, { error: "unknown session" }]) {
      const parsed = parseBlueprint(junk);
      expect(parsed, JSON.stringify(junk) ?? "undefined").toBeNull();
      expect(() => draw((parsed as { root: UIComponent } | null)?.root as UIComponent)).toThrow();
    }
  });

  it("keeps the body it already had when the answer cannot be read", () => {
    // the caller draws the parsed answer only when there is one; nothing is a reason to keep what
    // is on screen, not a reason to clear it
    const standing = parseBlueprint(BLUEPRINT)!;
    const incoming = parseBlueprint({ error: "unknown session" });
    const shown = incoming ?? standing;
    expect(shown).toBe(standing);
    expect(draw(shown.root)).toContain("src/routes.ts");
  });
});
