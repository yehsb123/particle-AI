"use client";

import React, { createContext, useContext, useState } from "react";
import type { UIAction, UIComponent } from "@particle/contracts";

type TreeItem = { label: string; children?: TreeItem[] };
type TimelineItem = { time?: string; label: string };

export type RendererCtx = {
  emitAction: (action: UIAction) => void;
  setFocus: (id: string) => void;
  clearFocus: () => void;
  /** translate a content label (identity in English) */
  tr: (s: string) => string;
  /** fill a localized template for generated sentences (id + identifier params) */
  tpl?: (id: string, params: Record<string, unknown>) => string;
};

const Ctx = createContext<RendererCtx>({
  emitAction: () => {},
  setFocus: () => {},
  clearFocus: () => {},
  tr: (s) => s,
});

export function RendererProvider({
  value,
  children,
}: {
  value: RendererCtx;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function prop<T = unknown>(node: UIComponent, key: string, fallback: T): T {
  const v = node.props?.[key];
  return (v === undefined ? fallback : (v as T)) as T;
}

/**
 * A prop shown as text, without translating it. `L` is for words the runtime chose and looks them
 * up; a value the runtime was handed is shown as it is, bounded and cleaned like any other.
 */
function shown(node: UIComponent, key: string, fallback = ""): string {
  return text(node.props?.[key], fallback);
}

/**
 * A prop shown as JSON. Stringify throws on a structure that refers to itself, and a prop can be
 * an object a capability returned rather than one that came off the wire, so it can. A throw here
 * takes the whole body down, not one card.
 */
function json(node: UIComponent, key: string): string {
  try {
    const out = JSON.stringify(node.props?.[key] ?? {}, null, 2) ?? "";
    return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}…` : out;
  } catch {
    return "(cannot be shown)";
  }
}

/** Numeric prop with coercion — never lets a non-number produce NaN in layout math. */
function num(node: UIComponent, key: string, fallback: number): number {
  const v = Number(node.props?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Text from a prop the model chose. A string, a number or a boolean reads as itself; anything
 * else is not text and shows as nothing, rather than putting "[object Object]" on the screen.
 */
/**
 * How much of one value the screen will show, and how many entries one list prop may have.
 *
 * Props are written by the model and checked for their shape, not their size: a label of five
 * million characters passed the gate and rendered whole, and a list prop of ten thousand entries
 * rendered every one. Neither is something a person reads; both are something a tab stops
 * responding to.
 */
export const MAX_TEXT = 4_000;
export const MAX_ITEMS = 500;

/**
 * Control characters, except the newline and tab a pre-wrap block needs. A carriage return is not
 * one of those: nothing here needs it, and it walks a terminal's cursor back over what it printed.
 * An escape sequence in a label is invisible where it lands and active wherever the text goes next.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function text(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  const kind = typeof v;
  if (kind !== "string" && kind !== "number" && kind !== "boolean") return fallback;
  const clean = String(v).replace(CONTROL_CHARACTERS, "");
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean;
}

/**
 * Array prop guaranteed to be an array — a malformed prop can never throw in .map/.join — and
 * guaranteed to be a length somebody could read.
 */
function arr<T>(node: UIComponent, key: string): T[] {
  const v = node.props?.[key];
  return Array.isArray(v) ? (v.length > MAX_ITEMS ? (v.slice(0, MAX_ITEMS) as T[]) : (v as T[])) : [];
}

function Children({ node }: { node: UIComponent }) {
  return (
    <>
      {(node.children ?? []).map((c) => (
        <Render key={c.id} node={c} />
      ))}
    </>
  );
}

/** Recursively render a validated UIComponent tree. No component-authored code runs here. */
export function Render({ node }: { node: UIComponent }) {
  const ctx = useContext(Ctx);
  // Translate a content label (title/text/badge/label) — identity in English.
  const L = (key: string, fb = ""): string => ctx.tr(text(node.props?.[key], fb));
  const highlighted = prop(node, "__highlighted", false);
  const collapsed = prop(node, "__collapsed", false);

  const wrap = (inner: React.ReactNode) => (
    <div className="node" data-id={node.id} data-highlighted={highlighted} data-collapsed={collapsed}>
      {inner}
    </div>
  );

  switch (node.type) {
    case "Stack":
      return wrap(<div className="stack collapsible"><Children node={node} /></div>);
    case "Row":
      return wrap(
        <div className="row collapsible" style={{ justifyContent: prop<string>(node, "justify", "flex-start") === "between" ? "space-between" : undefined, alignItems: prop<string>(node, "align", "stretch") }}>
          <Children node={node} />
        </div>,
      );
    case "Grid":
      return wrap(
        <div className="grid collapsible" style={{ gridTemplateColumns: `repeat(${num(node, "columns", 2)}, minmax(0,1fr))` }}>
          <Children node={node} />
        </div>,
      );
    case "SplitPane": {
      const ratio = num(node, "ratio", 0.5);
      return wrap(
        <div className="split collapsible" style={{ gridTemplateColumns: `${Math.round(ratio * 100)}% 1fr` }}>
          <Children node={node} />
        </div>,
      );
    }
    case "Panel": {
      const crit = prop<string>(node, "tone", "") === "critical";
      const badge = prop<string | undefined>(node, "badge", undefined);
      return wrap(
        <div className={`panel${crit ? " crit" : ""}`}>
          <div className="panel-title">
            <span>{L("title", "")}</span>
            {badge ? <span className="badge crit"><span className="dot" />{ctx.tr(text(badge))}</span> : null}
          </div>
          <div className="collapsible stack"><Children node={node} /></div>
        </div>,
      );
    }
    case "Card":
      return wrap(
        <div className="card">
          {prop<string | undefined>(node, "title", undefined) ? (
            <div className="panel-title"><span>{L("title", "")}</span></div>
          ) : null}
          <div className="collapsible stack"><Children node={node} /></div>
        </div>,
      );
    case "Heading":
      return wrap(<div className="heading" style={{ fontSize: 20 - (num(node, "level", 2) - 1) * 2 }}>{L("text", "")}</div>);
    case "Text":
      return wrap(<div>{L("text", "")}</div>);
    case "Markdown": {
      // generated sentences arrive as a template id + params (bound from a capability) and are
      // assembled in the viewer's language; plain `text` is the fallback
      const tpl = node.props?.tpl as { id?: unknown; params?: unknown } | undefined;
      const text =
        ctx.tpl && tpl && typeof tpl.id === "string"
          ? ctx.tpl(tpl.id, (tpl.params as Record<string, unknown> | undefined) ?? {})
          : L("text", "");
      return wrap(<div className="muted" style={{ whiteSpace: "pre-wrap" }}>{text}</div>);
    }
    case "Badge": {
      const tone = prop<string>(node, "tone", "muted");
      const cls = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "crit" ? "crit" : "";
      return wrap(<span className={`badge ${cls}`}><span className="dot" />{L("text", "")}</span>);
    }
    case "Button": {
      const tone = prop<string>(node, "tone", "default");
      const cls = tone === "primary" ? "primary" : tone === "muted" ? "muted" : "";
      return wrap(
        <button className={`btn ${cls}`} onClick={() => (node.actions ?? []).forEach(ctx.emitAction)}>
          {L("text", "Button")}
        </button>,
      );
    }
    case "Progress":
      return wrap(
        <div>
          <div className="progress"><span style={{ width: `${Math.round(num(node, "value", 0) * 100)}%` }} /></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{L("label", "")} {Math.round(num(node, "value", 0) * 100)}%</div>
        </div>,
      );
    case "Metric":
      // an object here used to throw: React refuses one as a child, and that empties the body
      return wrap(<div className="metric"><div className="value">{shown(node, "value")}</div><div className="label">{L("label", "")}</div></div>);
    case "Divider":
      return wrap(<div className="divider" />);
    case "Alert":
      return wrap(<div className="panel crit">{L("text", "")}</div>);
    case "Input":
      return wrap(
        <input
          className="input"
          aria-label={L("label", "") || L("placeholder", "") || node.id}
          defaultValue={shown(node, "value")}
          placeholder={shown(node, "placeholder")}
          onFocus={() => ctx.setFocus(node.id)}
          onBlur={() => ctx.clearFocus()}
        />,
      );
    case "Select":
      return wrap(
        <select className="select" aria-label={L("label", "") || L("title", "") || node.id}>
          {arr<string>(node, "options").map((o) => <option key={o}>{o}</option>)}
        </select>,
      );
    case "FileExplorer":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Files")}</span></div>
          <ul className="files collapsible">
            {arr<unknown>(node, "items").map((f, i) => <li key={i}>{text(f)}</li>)}
          </ul>
        </div>,
      );
    case "CodeEditor":
      return wrap(
        <div className="panel">
          <div className="panel-title">
            <span>{L("title", "editor")}</span>
            {node.volatile ? <span className="badge warn"><span className="dot" />{ctx.tr("unsaved")}</span> : null}
          </div>
          <textarea
            className="code"
            aria-label={L("title", "editor")}
            style={{ width: "100%", minHeight: 140, resize: "vertical" }}
            defaultValue={shown(node, "value")}
            onFocus={() => ctx.setFocus(node.id)}
            onBlur={() => ctx.clearFocus()}
          />
        </div>,
      );
    case "TerminalViewer":
      return wrap(<pre className="term" tabIndex={0}>{L("text", "")}</pre>);
    case "LogViewer":
      return wrap(
        <div>
          <div className="panel-title"><span>{L("title", "Logs")}</span></div>
          <pre className="logview" tabIndex={0}>{arr<unknown>(node, "lines").map((l) => text(l)).join("\n")}</pre>
        </div>,
      );
    case "DiffViewer": {
      const diff = shown(node, "diff");
      return wrap(
        <div>
          <div className="panel-title"><span>{L("title", "Diff")}</span></div>
          <pre className="diff" tabIndex={0}>
            {diff.split("\n").map((line, i) => (
              <div key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>{line}</div>
            ))}
          </pre>
        </div>,
      );
    }
    case "JSONViewer":
      return wrap(<pre className="code" tabIndex={0}>{json(node, "data")}</pre>);
    case "Table": {
      const columns = arr<string>(node, "columns");
      const rows = arr<string[]>(node, "rows");
      return wrap(
        <div>
          {prop<string | undefined>(node, "title", undefined) ? <div className="panel-title"><span>{L("title", "")}</span></div> : null}
          <table className="table">
            <thead><tr>{columns.map((c, i) => <th key={i}>{ctx.tr(text(c))}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                // a row the model got wrong is still shown, as one cell — never thrown over
                <tr key={i}>{(Array.isArray(r) ? r : [r]).map((cell, j) => <td key={j}>{ctx.tr(text(cell))}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    case "ActionPanel":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Actions")}</span></div>
          <div className="row collapsible" style={{ flexWrap: "wrap" }}><Children node={node} /></div>
        </div>,
      );
    case "ActivityFeed":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Activity")}</span></div>
          <div className="stack collapsible">
            {arr<unknown>(node, "items").map((it, i) => <div key={i} className="muted" style={{ fontSize: 12.5 }}>{text(it)}</div>)}
          </div>
        </div>,
      );
    case "Tabs":
      return wrap(<TabsNode node={node} />);
    case "Tree":
      return wrap(
        <div className="panel">
          {prop<string | undefined>(node, "title", undefined) ? <div className="panel-title"><span>{L("title", "")}</span></div> : null}
          <div className="collapsible"><TreeNodes nodes={arr<TreeItem>(node, "nodes")} /></div>
        </div>,
      );
    case "Timeline":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Timeline")}</span></div>
          <div className="timeline collapsible">
            {arr<TimelineItem>(node, "items").map((it, i) => (
              <div key={i} className="tl-item">
                <span className="tl-dot" />
                <span className="muted" style={{ minWidth: 64, fontFamily: "var(--mono)", fontSize: 11 }}>{text(it?.time)}</span>
                <span>{ctx.tr(text(it?.label))}</span>
              </div>
            ))}
          </div>
        </div>,
      );
    case "Chart": {
      const data = arr<number>(node, "data").map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
      const max = Math.max(1, ...data);
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Chart")}</span></div>
          <div className="chart collapsible">
            {data.map((v, i) => (
              <span key={i} className="bar" style={{ height: `${Math.round((v / max) * 100)}%` }} title={String(v)} />
            ))}
          </div>
        </div>,
      );
    }
    case "Inspector":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Inspector")}</span></div>
          <div className="kv collapsible">
            {arr<{ k?: unknown; v?: unknown }>(node, "entries").map((e, i) => (
              <React.Fragment key={i}><span className="k">{text(e?.k)}</span><span>{text(e?.v)}</span></React.Fragment>
            ))}
          </div>
          <div className="collapsible stack"><Children node={node} /></div>
        </div>,
      );
    case "DocumentViewer":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Document")}</span></div>
          <div className="collapsible" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{L("text", "")}</div>
        </div>,
      );
    case "Drawer":
    case "Overlay":
      return wrap(
        <div className="panel" style={{ borderStyle: "dashed" }}>
          <div className="panel-title"><span>{L("title", node.type)}</span><span className="badge">{node.type}</span></div>
          <div className="collapsible stack"><Children node={node} /></div>
        </div>,
      );
    default:
      // Any remaining registry component: safe generic container.
      return wrap(
        <div className="panel">
          <div className="panel-title"><span className="muted">{node.type}</span></div>
          <div className="collapsible stack"><Children node={node} /></div>
        </div>,
      );
  }
}

/** Interactive tabs: each child panel supplies its tab label via props.title. */
function TabsNode({ node }: { node: UIComponent }) {
  const panels = node.children ?? [];
  const [active, setActive] = useState(0);
  // Clamp so both the highlight and the shown panel agree even after a morph changes the tabs.
  const activeIdx = Math.min(active, Math.max(0, panels.length - 1));
  const current = panels[activeIdx];
  return (
    <div className="panel">
      <div className="devtabs" style={{ margin: "-12px -12px 12px" }}>
        {panels.map((p, i) => (
          <button key={p.id} className={`devtab${i === activeIdx ? " active" : ""}`} onClick={() => setActive(i)}>
            {(p.props?.title as string) ?? `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      {current ? <Render node={current} /> : null}
    </div>
  );
}

function TreeNodes({ nodes, depth = 0 }: { nodes: TreeItem[]; depth?: number }) {
  return (
    <ul className="files" style={{ marginLeft: depth ? 14 : 0 }}>
      {nodes.map((n, i) => (
        <li key={i}>
          {n?.children?.length ? "▸ " : "· "}{text(n?.label)}
          {n?.children?.length ? <TreeNodes nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}
