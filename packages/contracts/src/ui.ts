import { z } from "zod";
import { Confidence, IsoTimestamp, MAX_IDENTIFIER } from "./common";

/**
 * The complete set of approved component types. The model may only compose these.
 * Any type outside this set fails validation before it can reach the renderer.
 */
export const COMPONENT_TYPES = [
  // atoms
  "Text", "Heading", "Button", "Input", "Select", "Card", "Metric", "Badge",
  "Divider", "Progress", "Alert", "Markdown",
  // data
  "Table", "Chart", "Tree", "Timeline", "LogViewer", "JSONViewer", "DiffViewer",
  // workspace
  "CodeEditor", "TerminalViewer", "FileExplorer", "DocumentViewer", "Inspector",
  "ActivityFeed", "ActionPanel",
  // layout
  "Stack", "Row", "Grid", "SplitPane", "Tabs", "Panel", "Overlay", "Drawer",
] as const;

export const ComponentType = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentType>;

export const DataBinding = z.object({
  /** prop on the component that receives the bound value */
  prop: z.string().min(1),
  /** path into the world state / capability result store */
  source: z.string().min(1),
});
export type DataBinding = z.infer<typeof DataBinding>;

export const UIAction = z.object({
  /**
   * Event name emitted to the runtime when triggered (e.g. "user.requested_undo").
   *
   * This decides what pressing a button does, so it is a name the runtime acts on rather than a
   * caption, and it is held to the length every other identifier is. Refused rather than trimmed,
   * for the same reason a component id is: two names cut to the same length would ask the runtime
   * for the same thing.
   */
  event: z.string().min(1).max(MAX_IDENTIFIER),
  /** what the button says, if the action carries its own words rather than the component's */
  label: z.string().max(MAX_IDENTIFIER).optional(),
  /** capability id to invoke, if this action maps to one */
  capabilityId: z.string().min(1).max(MAX_IDENTIFIER).optional(),
  payload: z.record(z.unknown()).optional(),
});
export type UIAction = z.infer<typeof UIAction>;

/** JSON-serialisable prop bag. Deliberately permissive at the leaf. */
const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(JsonValue),
  ]),
);

export type UIComponent = {
  id: string;
  type: ComponentType;
  props?: Record<string, unknown>;
  bindings?: DataBinding[];
  actions?: UIAction[];
  /** true when the component holds unsaved user work; morph guard protects it */
  volatile?: boolean;
  children?: UIComponent[];
};

/**
 * How deep and how large a tree the gate will look at.
 *
 * The schema is recursive, so validating a tree walks it with the call stack — and a tree deep
 * enough overflows that stack inside the validator, which throws rather than refusing. The gate
 * dying is worse than the gate saying no: whatever called it goes down too, and in the body that
 * is the whole interface. The registry's own layouts are a handful of levels deep, so these are
 * far past anything real and far short of the stack.
 */
export const MAX_TREE_DEPTH = 100;
export const MAX_TREE_NODES = 2_000;

/**
 * Measures a raw tree without recursing into it, so it can say no to one that would take the
 * validator down. Anything that is not a tree passes straight through to the schema, which is
 * what says why it is not one.
 */
export function withinTreeLimits(root: unknown): boolean {
  if (!root || typeof root !== "object") return true;
  let seen = 0;
  const pending: { node: unknown; depth: number }[] = [{ node: root, depth: 1 }];
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== "object") continue;
    if (depth > MAX_TREE_DEPTH) return false;
    if (++seen > MAX_TREE_NODES) return false;
    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) pending.push({ node: child, depth: depth + 1 });
    }
  }
  return true;
}

/** A component tree, measured before it is walked. */
export const BoundedComponentTree = z
  .unknown()
  .refine(withinTreeLimits, `a component tree may be ${MAX_TREE_DEPTH} deep and ${MAX_TREE_NODES} nodes at most`);

// the input is unknown because the tree is measured before it is read, and the measurement
// takes whatever it is handed
export const UIComponent: z.ZodType<UIComponent, z.ZodTypeDef, unknown> = z.lazy(() =>
  // measured before it is walked, at every level: the schema is exported and validated directly
  // in places, and one that only guards its callers' entry points still takes the stack down for
  // anyone who calls it themselves
  BoundedComponentTree.pipe(
  z.object({
    /**
     * How a morph addresses this component later, so it is an identifier like any other and held
     * to the same length. Refused rather than trimmed: two long ids cut to the same length would
     * be the same component as far as every later patch could tell.
     */
    id: z.string().min(1).max(MAX_IDENTIFIER),
    type: ComponentType,
    props: z.record(JsonValue).optional(),
    bindings: z.array(DataBinding).optional(),
    actions: z.array(UIAction).optional(),
    volatile: z.boolean().optional(),
    children: z.array(UIComponent).optional(),
  })),
);

/**
 * Every reason the runtime can give for not reshaping the body. The body shows these to the
 * person in their own language, so the list lives here rather than in whichever module happens
 * to raise one: a reason nobody has words for reaches the screen as a bare identifier.
 */
export const MORPH_HOLD_REASONS = [
  "confidence_below_min",
  "structural_confidence_below_min",
  "cooldown_active",
  "major_dwell_active",
  "protects_focus",
  "protects_unsaved_state",
  "learned_preference",
  "structurally_impossible",
] as const;
export type MorphHoldReason = (typeof MORPH_HOLD_REASONS)[number];

export const UI_SCHEMA_VERSION = "1.0.0";

/**
 * Every id in a tree, walked without the call stack.
 *
 * This runs inside the blueprint's own check, and a check on an object whose root failed still
 * gets handed that root: a tree deep enough took the stack down here even though the measurement
 * in front of the schema had already refused it. A gate that dies takes its caller with it, so
 * nothing in the gate may recurse as deep as what it is looking at.
 *
 * It is handed raw data as well as validated components for the same reason, so a node that is
 * not one contributes nothing rather than throwing.
 */
function collectComponentIds(root: unknown): string[] {
  const ids: string[] = [];
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    const { id, children } = node as { id?: unknown; children?: unknown };
    if (typeof id === "string") ids.push(id);
    if (Array.isArray(children)) {
      for (const child of children) pending.push(child);
    }
  }
  return ids;
}

/** The first duplicate id in a component tree, or undefined if all ids are unique. */
export function firstDuplicateId(root: unknown): string | undefined {
  const seen = new Set<string>();
  for (const id of collectComponentIds(root)) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

export const UIBlueprint = z
  .object({
    // pinned: a blueprint written by another build must be rejected at the gate in front of the
    // renderer, not rendered under this build's assumptions (re-derive it from the event log instead)
    schemaVersion: z.literal(UI_SCHEMA_VERSION),
    workspaceId: z.string().min(1),
    goal: z.string().optional(),
    mode: z.string().min(1),
    root: BoundedComponentTree.pipe(UIComponent),
    metadata: z.object({
      generatedAt: IsoTimestamp,
      decisionId: z.string().min(1),
      confidence: Confidence,
      reasonSummary: z.string().optional(),
    }),
  })
  .superRefine((bp, ctx) => {
    // Stable morphing requires unique component ids — reject blueprints that violate it.
    const dup = firstDuplicateId(bp.root);
    if (dup) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root"], message: `duplicate component id: ${dup}` });
    }
  });
export type UIBlueprint = z.infer<typeof UIBlueprint>;

/* ── Patch protocol ─────────────────────────────────────────────── */

export const PATCH_OPS = [
  "add", "remove", "replace", "move",
  "updateProps", "updateBinding",
  "focus", "collapse", "expand", "highlight",
] as const;

export const AddOp = z.object({
  op: z.literal("add"),
  parentId: z.string().min(1),
  /** insertion index; appended if omitted */
  index: z.number().int().nonnegative().optional(),
  component: BoundedComponentTree.pipe(UIComponent),
});

export const RemoveOp = z.object({
  op: z.literal("remove"),
  targetId: z.string().min(1),
});

export const ReplaceOp = z.object({
  op: z.literal("replace"),
  targetId: z.string().min(1),
  component: BoundedComponentTree.pipe(UIComponent),
});

export const MoveOp = z.object({
  op: z.literal("move"),
  targetId: z.string().min(1),
  newParentId: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
});

export const UpdatePropsOp = z.object({
  op: z.literal("updateProps"),
  targetId: z.string().min(1),
  props: z.record(JsonValue),
});

export const UpdateBindingOp = z.object({
  op: z.literal("updateBinding"),
  targetId: z.string().min(1),
  bindings: z.array(DataBinding),
});

/** Non-structural, focus/emphasis-only operations. */
export const FocusOp = z.object({ op: z.literal("focus"), targetId: z.string().min(1) });
export const CollapseOp = z.object({ op: z.literal("collapse"), targetId: z.string().min(1) });
export const ExpandOp = z.object({ op: z.literal("expand"), targetId: z.string().min(1) });
export const HighlightOp = z.object({ op: z.literal("highlight"), targetId: z.string().min(1) });

export const UIPatchOperation = z.discriminatedUnion("op", [
  AddOp, RemoveOp, ReplaceOp, MoveOp,
  UpdatePropsOp, UpdateBindingOp,
  FocusOp, CollapseOp, ExpandOp, HighlightOp,
]);
export type UIPatchOperation = z.infer<typeof UIPatchOperation>;

export const UIPatch = z.object({
  patchId: z.string().min(1),
  fromWorkspaceId: z.string().min(1),
  /** decision that produced this patch, for audit/replay */
  decisionId: z.string().optional(),
  operations: z.array(UIPatchOperation),
});
export type UIPatch = z.infer<typeof UIPatch>;

/** Operations that restructure the tree (subject to stricter guard rules). */
export const STRUCTURAL_OPS = new Set(["add", "remove", "replace", "move"]);
export function isStructuralOp(op: UIPatchOperation["op"]): boolean {
  return STRUCTURAL_OPS.has(op);
}
