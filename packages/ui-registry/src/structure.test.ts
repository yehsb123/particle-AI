import { describe, it, expect } from "vitest";
import { UIBlueprint, UIComponent, UIPatch, type UIComponent as Component } from "@particle/contracts";
import { developmentBlueprint, incidentPatch, recoveryPatch, augmentPatch, type AugmentKind, type IncidentKind } from "./blueprints";

/**
 * Everything the runtime can put on screen is built here, and the morph engine now refuses a
 * patch that would introduce an id the tree already holds — so a layout carrying a duplicate id,
 * or reusing one the workspace already uses, would silently fail to appear rather than showing
 * the incident it was built for.
 */
const T = "2026-09-04T00:00:00Z";
const INCIDENT_KINDS: IncidentKind[] = ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"];
const AUGMENT_KINDS: AugmentKind[] = ["returning", "stuck", "switching"];

const idsOf = (node: Component, acc: string[] = []): string[] => {
  acc.push(node.id);
  for (const c of node.children ?? []) idsOf(c, acc);
  return acc;
};
const firstDuplicate = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
const addedComponents = (patch: { operations: { op: string; component?: Component }[] }) =>
  patch.operations.filter((o) => o.op === "add" || o.op === "replace").map((o) => o.component!).filter(Boolean);

const workspaceIds = idsOf(developmentBlueprint(T).root);

describe("the workspace someone starts in", () => {
  it("is a blueprint the renderer's gate accepts", () => {
    const dev = developmentBlueprint(T);
    expect(UIBlueprint.safeParse(dev).success).toBe(true);
    expect(dev.mode).toBe("development");
    expect(dev.metadata.generatedAt).toBe(T);
  });

  it("gives every part of itself its own id", () => {
    expect(firstDuplicate(workspaceIds)).toBeUndefined();
    expect(workspaceIds.length).toBeGreaterThan(5);
  });

  it("holds the editor the guard protects, and marks it as holding work", () => {
    const editor = findById(developmentBlueprint(T).root, "editor");
    expect(editor).toBeDefined();
    expect(editor?.volatile).toBe(true);
  });
});

describe("each incident layout", () => {
  for (const kind of INCIDENT_KINDS) {
    it(`${kind}: is a patch the runtime can apply`, () => {
      const patch = incidentPatch("d", kind, 0);
      expect(UIPatch.safeParse(patch).success).toBe(true);
      expect(patch.decisionId).toBe("d");
    });

    it(`${kind}: brings a panel called incident, with unique ids inside it`, () => {
      const components = addedComponents(incidentPatch("d", kind, 0));
      expect(components.map((c) => c.id)).toContain("incident");
      const ids = components.flatMap((c) => idsOf(c));
      expect(firstDuplicate(ids), `${kind}`).toBeUndefined();
    });

    it(`${kind}: never reuses an id the workspace already holds`, () => {
      // applyPatch refuses an id the tree already has, so a clash would mean the incident
      // never appears at all
      const ids = addedComponents(incidentPatch("d", kind, 0)).flatMap((c) => idsOf(c));
      expect(ids.filter((id) => workspaceIds.includes(id)), `${kind}`).toEqual([]);
    });

    it(`${kind}: still has unique ids once it says how often this has happened`, () => {
      const ids = addedComponents(incidentPatch("d", kind, 4)).flatMap((c) => idsOf(c));
      expect(firstDuplicate(ids), `${kind}`).toBeUndefined();
      expect(JSON.stringify(addedComponents(incidentPatch("d", kind, 4)))).toContain("recurring");
    });

    it(`${kind}: only asks for operations the morph engine implements`, () => {
      const implemented = new Set(["add", "remove", "replace", "move", "updateProps", "updateBinding", "focus", "collapse", "expand", "highlight"]);
      for (const op of incidentPatch("d", kind, 0).operations) expect(implemented.has(op.op), `${kind} ${op.op}`).toBe(true);
    });
  }

  it("lays each kind out differently", () => {
    const shapes = INCIDENT_KINDS.map((kind) => JSON.stringify(addedComponents(incidentPatch("d", kind, 0))));
    expect(new Set(shapes).size).toBe(INCIDENT_KINDS.length);
  });

  it("only names components the registry knows", () => {
    for (const kind of INCIDENT_KINDS) {
      for (const component of addedComponents(incidentPatch("d", kind, 0))) {
        expect(UIComponent.safeParse(component).success, kind).toBe(true);
      }
    }
  });
});

describe("going back to normal", () => {
  it("takes the incident away and gives the files back", () => {
    const patch = recoveryPatch("d");
    expect(UIPatch.safeParse(patch).success).toBe(true);
    expect(patch.operations.map((o) => `${o.op}:${"targetId" in o ? o.targetId : ""}`)).toEqual(["remove:incident", "expand:files"]);
  });
});

describe("each context card", () => {
  for (const kind of AUGMENT_KINDS) {
    it(`${kind}: is a patch with unique ids that do not clash with the workspace`, () => {
      const patch = augmentPatch("d", kind);
      expect(UIPatch.safeParse(patch).success).toBe(true);
      const ids = addedComponents(patch).flatMap((c) => idsOf(c));
      expect(firstDuplicate(ids), kind).toBeUndefined();
      expect(ids.filter((id) => workspaceIds.includes(id)), kind).toEqual([]);
    });

    it(`${kind}: is called context, so only one is ever on screen`, () => {
      expect(addedComponents(augmentPatch("d", kind)).map((c) => c.id)).toContain("context");
    });

    it(`${kind}: can be dismissed`, () => {
      const card = addedComponents(augmentPatch("d", kind))[0]!;
      expect(findById(card, "context-dismiss")).toBeDefined();
    });
  }
});

function findById(node: Component, id: string): Component | undefined {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const found = findById(c, id);
    if (found) return found;
  }
  return undefined;
}
