import { describe, it, expect } from "vitest";
import { emptyWorldState, type UIComponent, type WorldState } from "@particle/contracts";
import { developmentBlueprint, incidentPatch, augmentPatch, type AugmentKind, type IncidentKind } from "@particle/ui-registry";
import { builtinCapabilities, type Capability } from "@particle/capability-core";
import { resolvePatchBindings } from "./index";

/**
 * A card that shows live data declares a binding — a capability id and a field on its output —
 * and the runtime fills it in after that capability runs. The two halves live in different
 * packages: the binding in the component the registry builds, the field in what the capability
 * returns. Nothing would notice today if a capability stopped returning a field; the card would
 * quietly keep showing the placeholder it shipped with. This walks every binding and checks the
 * capability it names actually answers with what it promises.
 */
const T = "2026-09-04T00:00:00Z";
const INCIDENT_KINDS: IncidentKind[] = ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"];
const AUGMENT_KINDS: AugmentKind[] = ["returning", "stuck", "switching"];

const troubled: WorldState = {
  ...emptyWorldState("s", T),
  activeProblems: [{ id: "p", kind: "runtime_error", summary: "Service returned a runtime error", severity: "critical", openedByEventId: "e", openedAt: T }],
  environment: { processes: [], files: ["a.ts"] },
  behavior: { ...emptyWorldState("s", T).behavior, recentKeys: ["file:a", "file:b"], recentEntities: ["a.ts"], lastActionKey: "file:a", repeatCount: 3 },
};

const added = (patch: { operations: { op: string; component?: UIComponent }[] }): UIComponent[] =>
  patch.operations.filter((o) => o.op === "add" || o.op === "replace").map((o) => o.component!).filter(Boolean);

/** Every component the registry can put on screen. */
const everyTree = (): UIComponent[] => [
  developmentBlueprint(T).root,
  ...INCIDENT_KINDS.flatMap((kind) => added(incidentPatch("d", kind, 0))),
  ...INCIDENT_KINDS.flatMap((kind) => added(incidentPatch("d", kind, 3))),
  ...AUGMENT_KINDS.flatMap((kind) => added(augmentPatch("d", kind))),
];

const bindingsOf = (node: UIComponent, acc: { prop: string; source: string }[] = []) => {
  for (const b of node.bindings ?? []) acc.push(b);
  for (const c of node.children ?? []) bindingsOf(c, acc);
  return acc;
};

const allBindings = () => everyTree().flatMap((t) => bindingsOf(t));
const caps = new Map<string, Capability>(builtinCapabilities().map((c) => [c.manifest.id, c]));

describe("every binding on screen names something real", () => {
  it("declares at least one, so this test is watching something", () => {
    expect(allBindings().length).toBeGreaterThan(4);
  });

  it("uses the one source format the runtime knows how to read", () => {
    for (const b of allBindings()) {
      expect(b.source, b.source).toMatch(/^capability:[^:]+:.+$/);
      expect(b.prop.length, b.source).toBeGreaterThan(0);
    }
  });

  it("names a capability the runtime actually has", () => {
    for (const b of allBindings()) {
      const [, id] = /^capability:([^:]+):/.exec(b.source)!;
      expect(caps.has(id!), `${b.source}`).toBe(true);
    }
  });

  it("names a field that capability answers with", async () => {
    for (const b of allBindings()) {
      const [, id, field] = /^capability:([^:]+):(.+)$/.exec(b.source)!;
      const out = await caps.get(id!)!.execute(undefined, { sessionId: "s", now: T, worldState: troubled });
      expect(out.ok, b.source).toBe(true);
      expect(Object.hasOwn((out.output ?? {}) as object, field!), b.source).toBe(true);
    }
  });

  it("answers with that field even on a fresh session with nothing wrong", async () => {
    for (const b of allBindings()) {
      const [, id, field] = /^capability:([^:]+):(.+)$/.exec(b.source)!;
      const out = await caps.get(id!)!.execute(undefined, { sessionId: "s", now: T });
      expect(out.ok, b.source).toBe(true);
      expect(Object.hasOwn((out.output ?? {}) as object, field!), b.source).toBe(true);
    }
  });

  it("only ever binds to a capability that reads, never one that acts", () => {
    // a card filling itself in must not be able to change anything outside the runtime
    for (const b of allBindings()) {
      const [, id] = /^capability:([^:]+):/.exec(b.source)!;
      expect(caps.get(id!)!.manifest.risk, b.source).toBe("read");
    }
  });
});

describe("the runtime fills those bindings in", () => {
  it("puts the live value into the bound prop, for every binding the registry declares", async () => {
    const lookup = new Map<string, unknown>();
    for (const [id, cap] of caps) {
      const out = await cap.execute(undefined, { sessionId: "s", now: T, worldState: troubled });
      if (out.ok) lookup.set(id, out.output);
    }

    for (const kind of INCIDENT_KINDS) {
      const patch = incidentPatch("d", kind, 0);
      const resolved = resolvePatchBindings(patch, lookup);
      for (const component of added(resolved)) {
        for (const b of bindingsOf(component)) {
          const holder = findBound(component, b.source);
          expect(holder, `${kind} ${b.source}`).toBeDefined();
          expect(holder!.props?.[b.prop], `${kind} ${b.source}`).toBeDefined();
        }
      }
    }
  });

  it("leaves the placeholder alone when the capability did not run", () => {
    const patch = incidentPatch("d", "runtime_error", 0);
    const before = JSON.stringify(patch);
    const resolved = resolvePatchBindings(patch, new Map());
    expect(JSON.stringify(patch)).toBe(before); // the patch itself is untouched
    for (const component of added(resolved)) {
      for (const b of bindingsOf(component)) {
        const holder = findBound(component, b.source)!;
        const original = findBound(added(patch)[0]!, b.source)!;
        expect(holder.props?.[b.prop]).toEqual(original.props?.[b.prop]);
      }
    }
  });
});

function findBound(node: UIComponent, source: string): UIComponent | undefined {
  if ((node.bindings ?? []).some((b) => b.source === source)) return node;
  for (const c of node.children ?? []) {
    const found = findBound(c, source);
    if (found) return found;
  }
  return undefined;
}
