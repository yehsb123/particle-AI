import { describe, it, expect } from "vitest";
import { REGISTRY, isKnownComponent, isContainer } from "./registry";
import { developmentBlueprint, incidentPatch } from "./blueprints";
import { COMPONENT_TYPES, UIBlueprint, UIPatch } from "@dm/contracts";

describe("ui-registry", () => {
  it("has metadata for every declared component type", () => {
    for (const t of COMPONENT_TYPES) expect(REGISTRY[t]).toBeDefined();
  });

  it("recognises known vs unknown components", () => {
    expect(isKnownComponent("CodeEditor")).toBe(true);
    expect(isKnownComponent("Nonsense")).toBe(false);
  });

  it("marks layout/panel components as containers", () => {
    expect(isContainer("Panel")).toBe(true);
    expect(isContainer("Text")).toBe(false);
  });

  it("the development blueprint is schema-valid", () => {
    const r = UIBlueprint.safeParse(developmentBlueprint("2026-01-01T00:00:00Z"));
    expect(r.success).toBe(true);
  });

  it("the incident patch is schema-valid", () => {
    const r = UIPatch.safeParse(incidentPatch());
    expect(r.success).toBe(true);
  });
});
