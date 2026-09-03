import { z } from "zod";
import { Confidence, IsoTimestamp } from "./common";

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
  /** event name emitted to the runtime when triggered (e.g. "user.requested_undo") */
  event: z.string().min(1),
  label: z.string().optional(),
  /** capability id to invoke, if this action maps to one */
  capabilityId: z.string().optional(),
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

export const UIComponent: z.ZodType<UIComponent> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: ComponentType,
    props: z.record(JsonValue).optional(),
    bindings: z.array(DataBinding).optional(),
    actions: z.array(UIAction).optional(),
    volatile: z.boolean().optional(),
    children: z.array(UIComponent).optional(),
  }),
);

export const UI_SCHEMA_VERSION = "1.0.0";

function collectComponentIds(node: UIComponent, acc: string[] = []): string[] {
  acc.push(node.id);
  for (const child of node.children ?? []) collectComponentIds(child, acc);
  return acc;
}

/** The first duplicate id in a component tree, or undefined if all ids are unique. */
export function firstDuplicateId(root: UIComponent): string | undefined {
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
    root: UIComponent,
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
  component: UIComponent,
});

export const RemoveOp = z.object({
  op: z.literal("remove"),
  targetId: z.string().min(1),
});

export const ReplaceOp = z.object({
  op: z.literal("replace"),
  targetId: z.string().min(1),
  component: UIComponent,
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
