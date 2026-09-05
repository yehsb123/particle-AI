import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyWorldState } from "@particle/contracts";
import { DeveloperInspector, type DebugState } from "./DeveloperInspector";
import { MAX_TEXT } from "./Renderer";

/**
 * Static markup lands on the tab a component opens with, and the inspector opens on the trace —
 * so until now the world, decision, memory and audit tabs had never been rendered by anything but
 * a person clicking them.
 *
 * The audit tab is the one fed from outside: a decision frame's records arrive over the socket.
 * That door now checks each record, and this checks what the tab does with one anyway, because
 * the inspector is where a person goes to find out why their body changed and is the last surface
 * that should go blank.
 */
const T = "2026-09-05T00:00:00Z";
const draw = (debug: Partial<DebugState>, openOn: "trace" | "world" | "decision" | "memory" | "audit") =>
  renderToStaticMarkup(
    createElement(DeveloperInspector, { debug: { traces: [], audit: [], ...debug } as DebugState, lang: "en", openOn }),
  );

const record = (over: Record<string, unknown> = {}) => ({ id: "a1", kind: "decision", detail: { why: "significant" }, ...over });

describe("every tab draws", () => {
  const tabs = ["trace", "world", "decision", "memory", "audit"] as const;

  it("with nothing to show yet", () => {
    for (const tab of tabs) {
      expect(() => draw({}, tab), tab).not.toThrow();
      expect(draw({}, tab).length, tab).toBeGreaterThan(0);
    }
  });

  it("with something to show", () => {
    const debug: Partial<DebugState> = {
      worldState: emptyWorldState("s", T),
      audit: [record()],
      memory: { episodes: [{ context: "incident", summary: "service recovered" }], preferences: [], patterns: [] },
    };
    for (const tab of tabs) expect(() => draw(debug, tab), tab).not.toThrow();
    expect(draw(debug, "world")).toContain("activeProblems");
    expect(draw(debug, "audit")).toContain("decision");
    expect(draw(debug, "memory")).toContain("service recovered");
  });
});

describe("an audit record that is not one", () => {
  const notRecords: unknown[] = [null, undefined, 7, "a record", [], true];

  it("does not empty the tab", () => {
    for (const a of notRecords) {
      expect(() => draw({ audit: [a] as DebugState["audit"] }, "audit"), String(a)).not.toThrow();
    }
    expect(() => draw({ audit: notRecords as DebugState["audit"] }, "audit")).not.toThrow();
  });

  it("is skipped, while the ones beside it are still shown", () => {
    const html = draw({ audit: [null, record({ kind: "capability_approved" }), 7] as unknown as DebugState["audit"] }, "audit");
    expect(html).toContain("capability_approved");
  });
});

describe("an audit record whose parts are not what they claim", () => {
  it("shows a kind that is an object as nothing, rather than throwing", () => {
    // React refuses an object as a child, and a throw here takes the inspector down with it
    const html = draw({ audit: [record({ kind: { a: 1 } })] as unknown as DebugState["audit"] }, "audit");
    expect(html).not.toContain("[object Object]");
  });

  it("cuts a kind too long to read", () => {
    const html = draw({ audit: [record({ kind: "k".repeat(1_000_000) })] as unknown as DebugState["audit"] }, "audit");
    expect(html.length).toBeLessThan(MAX_TEXT + 2_000);
  });

  it("cuts a detail too long to read", () => {
    const html = draw({ audit: [record({ detail: { big: "d".repeat(1_000_000) } })] as unknown as DebugState["audit"] }, "audit");
    expect(html.length).toBeLessThan(MAX_TEXT + 2_000);
  });

  it("shows a detail that refers to itself as unshowable", () => {
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    const html = draw({ audit: [record({ detail: circular })] as unknown as DebugState["audit"] }, "audit");
    expect(html).toContain("cannot be shown");
  });

  it("gives every row its own key even when two records share an id", () => {
    // duplicate ids collapsed rows in the strip once already; the row key is its own now
    const html = draw({ audit: [record({ kind: "one" }), record({ kind: "two" })] }, "audit");
    expect(html).toContain("one");
    expect(html).toContain("two");
  });
});
