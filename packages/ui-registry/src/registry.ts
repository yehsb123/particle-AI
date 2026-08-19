import { COMPONENT_TYPES, type ComponentType } from "@dm/contracts";

export type ComponentCategory = "atom" | "data" | "workspace" | "layout";

export type ComponentMeta = {
  type: ComponentType;
  category: ComponentCategory;
  /** whether this component renders children */
  container: boolean;
};

const CATEGORY: Record<ComponentType, ComponentCategory> = {
  Text: "atom", Heading: "atom", Button: "atom", Input: "atom", Select: "atom",
  Card: "atom", Metric: "atom", Badge: "atom", Divider: "atom", Progress: "atom",
  Alert: "atom", Markdown: "atom",
  Table: "data", Chart: "data", Tree: "data", Timeline: "data", LogViewer: "data",
  JSONViewer: "data", DiffViewer: "data",
  CodeEditor: "workspace", TerminalViewer: "workspace", FileExplorer: "workspace",
  DocumentViewer: "workspace", Inspector: "workspace", ActivityFeed: "workspace",
  ActionPanel: "workspace",
  Stack: "layout", Row: "layout", Grid: "layout", SplitPane: "layout", Tabs: "layout",
  Panel: "layout", Overlay: "layout", Drawer: "layout",
};

const CONTAINERS = new Set<ComponentType>([
  "Card", "Stack", "Row", "Grid", "SplitPane", "Tabs", "Panel", "Overlay", "Drawer",
  "ActionPanel", "Inspector",
]);

export const REGISTRY: Record<ComponentType, ComponentMeta> = Object.fromEntries(
  COMPONENT_TYPES.map((t) => [
    t,
    { type: t, category: CATEGORY[t], container: CONTAINERS.has(t) },
  ]),
) as Record<ComponentType, ComponentMeta>;

export function isKnownComponent(type: string): type is ComponentType {
  return type in REGISTRY;
}

export function isContainer(type: ComponentType): boolean {
  return REGISTRY[type].container;
}
