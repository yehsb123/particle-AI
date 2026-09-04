import { describe, it, expect } from "vitest";
import type { UIBlueprint, UIComponent, UIPatch } from "@particle/contracts";
import { planMorph } from "./morphology";
import { developmentBlueprint, incidentPatch, recoveryPatch, augmentPatch, AUGMENT_TITLES, type AugmentKind } from "./blueprints";
import { REGISTRY, isKnownComponent, isContainer } from "./registry";

/**
 * planMorph turns an intent into a concrete patch, and its most important property is knowing
 * when to do nothing: the runtime deliberates on every significant event, so a planner that
 * re-issued the same change would make the interface flicker under a stream of them.
 */
const T = "2026-09-04T00:00:00Z";

/** The development workspace with an extra node dropped in, standing for a body mid-morph. */
function withNode(node: UIComponent): UIBlueprint {
  const base = developmentBlueprint(T);
  return { ...base, root: { ...base.root, children: [...(base.root.children ?? []), node] } };
}

const ids = (patch: UIPatch | null) => patch?.operations.map((o) => (o.op === "add" ? `add:${o.component.id}` : `${o.op}:${o.targetId}`)) ?? null;
const find = (node: UIComponent, id: string): UIComponent | undefined =>
  node.id === id ? node : (node.children ?? []).map((c) => find(c, id)).find(Boolean);
const addedComponent = (patch: UIPatch | null): UIComponent | undefined => {
  const op = patch?.operations.find((o) => o.op === "add" || o.op === "replace");
  return op && (op.op === "add" || op.op === "replace") ? op.component : undefined;
};

describe("surfacing an incident", () => {
  it("builds the panel when nothing is up", () => {
    const patch = planMorph(developmentBlueprint(T), "surface_incident", "d1", "runtime_error", 0);
    expect(ids(patch)).toContain("add:incident");
    expect(patch?.operations.every((o) => o.op === "add" || o.op === "highlight" || o.op === "focus" || o.op === "collapse")).toBe(true);
  });

  it("does nothing while an incident is already showing", () => {
    // the runtime deliberates on every significant event; re-adding the panel would flicker
    const showing = withNode({ id: "incident", type: "Panel", children: [] });
    expect(planMorph(showing, "surface_incident", "d2", "runtime_error", 0)).toBeNull();
    expect(planMorph(showing, "surface_incident", "d2", "security_alert", 0)).toBeNull();
  });

  it("lays the panel out for the kind of problem it is", () => {
    const seen = new Map<string, string>();
    for (const kind of ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"] as const) {
      const panel = addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", kind, 0));
      expect(panel?.id, kind).toBe("incident");
      seen.set(kind, JSON.stringify(panel));
    }
    expect(new Set(seen.values()).size).toBe(5); // five kinds, five layouts
    expect(JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "test_failure", 0)))).toContain("incident-tests");
    expect(JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "network_failure", 0)))).toContain("incident-hosts");
  });

  it("falls back to a runtime error for a kind it does not know", () => {
    const unknown = JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "meteor_strike", 0)));
    const fallback = JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "runtime_error", 0)));
    expect(unknown).toBe(fallback);
    expect(JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", undefined, 0)))).toBe(fallback);
  });

  it("says how many times this has happened before, once it has", () => {
    const first = JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "runtime_error", 0)));
    const again = JSON.stringify(addedComponent(planMorph(developmentBlueprint(T), "surface_incident", "d1", "runtime_error", 3)));
    expect(first).not.toContain("recurring");
    expect(again).toContain("recurring");
    expect(again).toContain("×3");
  });
});

describe("going back to normal", () => {
  it("takes the incident away when one is up", () => {
    const showing = withNode({ id: "incident", type: "Panel", children: [] });
    expect(ids(planMorph(showing, "restore_normal", "d1"))).toContain("remove:incident");
  });

  it("does nothing when there is nothing to take away", () => {
    expect(planMorph(developmentBlueprint(T), "restore_normal", "d1")).toBeNull();
  });
});

describe("augmenting with context", () => {
  const titleOf = (bp: UIBlueprint) => find(bp.root, "context")?.props?.title;

  it("adds one context card, named for the situation", () => {
    for (const kind of ["returning", "stuck", "switching"] as AugmentKind[]) {
      const patch = planMorph(developmentBlueprint(T), "augment", "d1", kind);
      expect(addedComponent(patch)?.props?.title, kind).toBe(AUGMENT_TITLES[kind]);
      expect(ids(patch)?.[0], kind).toBe("add:context");
    }
  });

  it("does nothing when the same card is already there", () => {
    const showing = withNode({ id: "context", type: "Card", props: { title: AUGMENT_TITLES.stuck } });
    expect(planMorph(showing, "augment", "d2", "stuck")).toBeNull();
  });

  it("replaces the card rather than stacking a second one", () => {
    // one context card at a time: a different situation swaps what is on screen
    const showing = withNode({ id: "context", type: "Card", props: { title: AUGMENT_TITLES.stuck } });
    const patch = planMorph(showing, "augment", "d3", "switching");
    expect(ids(patch)).toEqual(["replace:context"]);
    expect(addedComponent(patch)?.props?.title).toBe(AUGMENT_TITLES.switching);
  });

  it("treats a variant it does not know as coming back to something", () => {
    expect(addedComponent(planMorph(developmentBlueprint(T), "augment", "d1", "nonsense"))?.props?.title).toBe(AUGMENT_TITLES.returning);
    expect(addedComponent(planMorph(developmentBlueprint(T), "augment", "d1", undefined))?.props?.title).toBe(AUGMENT_TITLES.returning);
  });

  it("keeps the dismiss button, so the person can always say no", () => {
    const card = addedComponent(planMorph(developmentBlueprint(T), "augment", "d1", "stuck"));
    expect(find(card!, "context-dismiss")).toBeDefined();
    expect(titleOf(withNode(card!))).toBe(AUGMENT_TITLES.stuck);
  });
});

describe("intents that ask for nothing", () => {
  it("plans nothing for none, and for an intent that does not exist", () => {
    expect(planMorph(developmentBlueprint(T), "none", "d1")).toBeNull();
    expect(planMorph(developmentBlueprint(T), "explode" as "none", "d1")).toBeNull();
  });
});

describe("the patches themselves", () => {
  it("carry the decision that asked for them", () => {
    expect(incidentPatch("d-inc", "runtime_error", 0).decisionId).toBe("d-inc");
    expect(recoveryPatch("d-rec").decisionId).toBe("d-rec");
    expect(augmentPatch("d-aug", "stuck").decisionId).toBe("d-aug");
  });

  it("only ever name components the registry knows", () => {
    const types = (node: UIComponent): string[] => [node.type, ...(node.children ?? []).flatMap(types)];
    const everyComponent = [
      ...(["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"] as const).map((k) => addedComponent(incidentPatch("d", k, 0))!),
      ...(["returning", "stuck", "switching"] as AugmentKind[]).map((k) => addedComponent(augmentPatch("d", k))!),
      developmentBlueprint(T).root,
    ];
    for (const component of everyComponent) {
      for (const type of types(component)) expect(isKnownComponent(type), type).toBe(true);
    }
  });

  it("give every component an id, so a morph can always find it again", () => {
    const collect = (node: UIComponent): string[] => [node.id, ...(node.children ?? []).flatMap(collect)];
    const all = collect(addedComponent(incidentPatch("d", "runtime_error", 0))!);
    expect(all.every((id) => id.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the component registry", () => {
  it("knows a category and a container flag for every type it lists", () => {
    for (const [type, meta] of Object.entries(REGISTRY)) {
      expect(meta.type, type).toBe(type);
      expect(["atom", "data", "workspace", "layout"]).toContain(meta.category);
      expect(typeof meta.container).toBe("boolean");
    }
  });

  it("says a layout component holds children and an atom does not", () => {
    expect(isContainer("Stack")).toBe(true);
    expect(isContainer("Grid")).toBe(true);
    expect(isContainer("Card")).toBe(true);
    expect(isContainer("Text")).toBe(false);
    expect(isContainer("Metric")).toBe(false);
  });

  it("does not recognise a type nobody registered", () => {
    for (const type of ["Fictional", "", "stack", "Div"]) {
      expect(isKnownComponent(type), type).toBe(false);
    }
  });

  it("does not mistake a property of every object for a component", () => {
    // `in` walks the prototype chain, so these used to answer yes and then behave like a
    // component that is not there — isContainer returned undefined where a boolean was promised
    for (const type of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(isKnownComponent(type), type).toBe(false);
      expect(isContainer(type as never), type).toBe(false);
    }
  });
});
