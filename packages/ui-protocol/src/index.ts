import {
  UIBlueprint,
  UIPatch,
  UIComponent,
  type UIComponent as UIComponentT,
} from "@dm/contracts";
import { z } from "zod";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: z.ZodIssue[] };

function toResult<T>(r: z.SafeParseReturnType<unknown, T>): ParseResult<T> {
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    issues: r.error.issues,
  };
}

/** Validate a full blueprint. Invalid blueprints must never reach the renderer. */
export function parseBlueprint(input: unknown): ParseResult<UIBlueprint> {
  return toResult(UIBlueprint.safeParse(input));
}

/** Validate a patch. Invalid patches must never be applied. */
export function parsePatch(input: unknown): ParseResult<UIPatch> {
  return toResult(UIPatch.safeParse(input));
}

export function parseComponent(input: unknown): ParseResult<UIComponentT> {
  return toResult(UIComponent.safeParse(input));
}

/** Collect all component ids in a subtree (depth-first). */
export function collectIds(node: UIComponentT, acc: string[] = []): string[] {
  acc.push(node.id);
  for (const child of node.children ?? []) collectIds(child, acc);
  return acc;
}

/** True if the tree has no duplicate ids (a precondition for stable morphing). */
export function hasUniqueIds(node: UIComponentT): boolean {
  const ids = collectIds(node);
  return new Set(ids).size === ids.length;
}

/** Find a component by id anywhere in the tree. */
export function findById(node: UIComponentT, id: string): UIComponentT | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Find the parent of a node by child id. */
export function findParent(
  node: UIComponentT,
  childId: string,
): UIComponentT | undefined {
  for (const child of node.children ?? []) {
    if (child.id === childId) return node;
    const found = findParent(child, childId);
    if (found) return found;
  }
  return undefined;
}

export { UIBlueprint, UIPatch, UIComponent };
