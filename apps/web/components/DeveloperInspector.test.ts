import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeveloperInspector, type DebugState, type TraceRow } from "./DeveloperInspector";

/**
 * The inspector is the answer to "why did the interface change?", so what it shows has to be
 * true even when the runtime has nothing to say yet, and readable when a morph was refused.
 * Rendered to static markup, which lands on the tab it opens with.
 */
const row = (over: Partial<TraceRow> = {}): TraceRow => ({
  n: 1,
  eventType: "development.server_error",
  significance: 0.82,
  deliberated: true,
  provider: "mock",
  intent: "surface_incident",
  morphApplied: true,
  capabilities: ["development.read_logs"],
  guardReasonCodes: [],
  ...over,
});

const render = (debug: Partial<DebugState> = {}, lang: "en" | "ko" = "en") =>
  renderToStaticMarkup(createElement(DeveloperInspector, { debug: { traces: [], audit: [], ...debug }, lang }));

describe("with nothing to show yet", () => {
  it("says so rather than drawing an empty table and calling it a day", () => {
    const html = render();
    expect(html).toContain("No events yet.");
    expect(html).toContain("devpanel");
  });

  it("offers every tab, in the language asked for", () => {
    const en = render();
    for (const label of ["Event trace", "World state", "Decision", "Memory", "Audit"]) {
      expect(en, label).toContain(label);
    }
    const ko = render({}, "ko");
    for (const label of ["이벤트 트레이스", "월드 상태", "결정", "메모리", "감사"]) {
      expect(ko, label).toContain(label);
    }
  });

  it("renders without a world state, a decision or a memory snapshot", () => {
    expect(() => render({ worldState: undefined, last: undefined, memory: undefined })).not.toThrow();
  });
});

describe("the event trace", () => {
  it("shows what happened, how much it mattered, and what ran", () => {
    const html = render({ traces: [row()] });
    expect(html).toContain("development.server_error");
    expect(html).toContain("82%"); // significance as a percentage a person can read
    expect(html).toContain("mock");
    expect(html).toContain("surface_incident");
    expect(html).toContain("development.read_logs");
    expect(html).not.toContain("No events yet.");
  });

  it("says why the body did not change, instead of just saying it did not", () => {
    const html = render({ traces: [row({ morphApplied: false, guardReasonCodes: ["protects_unsaved_state"] })] });
    expect(html).toContain("protects_unsaved_state");
  });

  it("marks an event the runtime answered without deliberating", () => {
    const html = render({ traces: [row({ deliberated: false, provider: undefined, intent: undefined, morphApplied: false })] });
    expect(html).toContain("reflex");
  });

  it("puts a dash where there is nothing to say", () => {
    const html = render({ traces: [row({ provider: undefined, intent: undefined, capabilities: [], morphApplied: false, guardReasonCodes: [] })] });
    expect(html).toContain("—");
  });

  it("rounds significance to whole percent, at both ends", () => {
    const html = render({ traces: [row({ n: 1, significance: 0 }), row({ n: 2, significance: 1 }), row({ n: 3, significance: 0.005 })] });
    expect(html).toContain("0%");
    expect(html).toContain("100%");
    expect(html).toContain("1%");
  });

  it("lists every event it was given, in order", () => {
    const traces = [1, 2, 3].map((n) => row({ n, eventType: `event.number_${n}` }));
    const html = render({ traces });
    expect(html.indexOf("event.number_1")).toBeLessThan(html.indexOf("event.number_2"));
    expect(html.indexOf("event.number_2")).toBeLessThan(html.indexOf("event.number_3"));
  });

  it("shows several capabilities as one readable list", () => {
    const html = render({ traces: [row({ capabilities: ["a.read", "b.read", "c.inspect"] })] });
    expect(html).toContain("a.read, b.read, c.inspect");
  });

  it("does not fall over on an event type that looks like markup", () => {
    const html = render({ traces: [row({ eventType: "<script>alert(1)</script>" })] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
