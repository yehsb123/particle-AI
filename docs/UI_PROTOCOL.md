# UI Protocol

The model never emits code. It emits **data** describing an interface, validated against a
fixed registry of approved components. This is the reliability cornerstone.

## UIBlueprint

A full description of a workspace:

```ts
type UIBlueprint = {
  schemaVersion: string;
  workspaceId: string;
  goal?: string;
  mode: string;              // e.g. "development" | "incident"
  root: UIComponent;
  metadata: {
    generatedAt: string;
    decisionId: string;
    confidence: number;
    reasonSummary?: string;  // externally safe; never chain-of-thought
  };
};
```

## UIComponent

```ts
type UIComponent = {
  id: string;                // STABLE across morphs when conceptually the same
  type: string;              // must exist in the component registry
  props?: Record<string, unknown>;
  bindings?: DataBinding[];
  actions?: UIAction[];
  children?: UIComponent[];
};
```

**Identity is by `id`, never by position.** When the conceptual component persists, its id
persists — this is what lets the morph engine diff and preserve focus.

## Approved component registry

- **Atoms:** Text, Heading, Button, Input, Select, Card, Metric, Badge, Divider, Progress, Alert, Markdown
- **Data:** Table, Chart, Tree, Timeline, LogViewer, JSONViewer, DiffViewer
- **Workspace:** CodeEditor, TerminalViewer, FileExplorer, DocumentViewer, Inspector, ActivityFeed, ActionPanel
- **Layout:** Stack, Row, Grid, SplitPane, Tabs, Panel, Overlay, Drawer

Any `type` outside this set fails Zod validation and is rejected before render.

## Data bindings (implemented)

`UIComponent.bindings` connects a prop to live data produced by a capability during the same
runtime step:

```ts
{ prop: "lines", source: "capability:development.read_logs:lines" }
```

`runtime-core.resolvePatchBindings(patch, outputs)` (pure) resolves every binding in the
desired patch **before** the morph guard: when the capability ran successfully and the field
exists on its output, the bound prop is overwritten. Blueprints keep a harmless placeholder
(`lines: ["collecting…"]`, `rows: []`) so the layout is valid even if a capability was denied
or failed. This is how "execution → feedback → body" closes: the incident LogViewer shows the
real `read_logs` output and the security table shows real `scan_dependencies` rows.

## UIPatch — morphing by diff, not regeneration

The interface is never regenerated wholesale. The model (or planner) proposes a patch:

```ts
type UIPatch = {
  patchId: string;
  fromWorkspaceId: string;
  operations: UIPatchOperation[];
};
```

Operations: `add`, `remove`, `replace`, `move`, `updateProps`, `updateBinding`, `focus`,
`collapse`, `expand`, `highlight`.

Every patch and blueprint is validated by Zod. Invalid output never reaches the renderer.

## Reversibility

Applying a patch produces an inverse patch, stored in UI history. `Undo last morph` pops
history and applies the inverse. See `MORPH_ENGINE.md`.
