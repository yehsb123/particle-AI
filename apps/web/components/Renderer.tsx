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

/** Numeric prop with coercion — never lets a non-number produce NaN in layout math. */
function num(node: UIComponent, key: string, fallback: number): number {
  const v = Number(node.props?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

/** Array prop guaranteed to be an array — a malformed prop can never throw in .map/.join. */
function arr<T>(node: UIComponent, key: string): T[] {
  const v = node.props?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
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
  const L = (key: string, fb = ""): string => ctx.tr(String(prop(node, key, fb)));
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
            {badge ? <span className="badge crit"><span className="dot" />{ctx.tr(badge)}</span> : null}
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
    case "Markdown":
      return wrap(<div className="muted" style={{ whiteSpace: "pre-wrap" }}>{L("text", "")}</div>);
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
      return wrap(<div className="metric"><div className="value">{prop(node, "value", "")}</div><div className="label">{L("label", "")}</div></div>);
    case "Divider":
      return wrap(<div className="divider" />);
    case "Alert":
      return wrap(<div className="panel crit">{L("text", "")}</div>);
    case "Input":
      return wrap(
        <input
          className="input"
          defaultValue={prop(node, "value", "")}
          placeholder={prop(node, "placeholder", "")}
          onFocus={() => ctx.setFocus(node.id)}
          onBlur={() => ctx.clearFocus()}
        />,
      );
    case "Select":
      return wrap(
        <select className="select">
          {arr<string>(node, "options").map((o) => <option key={o}>{o}</option>)}
        </select>,
      );
    case "FileExplorer":
      return wrap(
        <div className="panel">
          <div className="panel-title"><span>{L("title", "Files")}</span></div>
          <ul className="files collapsible">
            {arr<string>(node, "items").map((f) => <li key={f}>{f}</li>)}
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
            style={{ width: "100%", minHeight: 140, resize: "vertical" }}
            defaultValue={prop(node, "value", "")}
            onFocus={() => ctx.setFocus(node.id)}
            onBlur={() => ctx.clearFocus()}
          />
        </div>,
      );
    case "TerminalViewer":
      return wrap(<pre className="term">{L("text", "")}</pre>);
    case "LogViewer":
      return wrap(
        <div>
          <div className="panel-title"><span>{L("title", "Logs")}</span></div>
          <pre className="logview">{arr<string>(node, "lines").join("\n")}</pre>
        </div>,
      );
    case "DiffViewer": {
      const diff = String(prop(node, "diff", ""));
      return wrap(
        <div>
          <div className="panel-title"><span>{L("title", "Diff")}</span></div>
          <pre className="diff">
            {diff.split("\n").map((line, i) => (
              <div key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>{line}</div>
            ))}
          </pre>
        </div>,
      );
    }
    case "JSONViewer":
      return wrap(<pre className="code">{JSON.stringify(prop(node, "data", {}), null, 2)}</pre>);
    case "Table": {
      const columns = arr<string>(node, "columns");
      const rows = arr<string[]>(node, "rows");
      return wrap(
        <div>
          {prop<string | undefined>(node, "title", undefined) ? <div className="panel-title"><span>{L("title", "")}</span></div> : null}
          <table className="table">
            <thead><tr>{columns.map((c) => <th key={c}>{ctx.tr(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{ctx.tr(String(cell))}</td>)}</tr>)}</tbody>
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
            {arr<string>(node, "items").map((it, i) => <div key={i} className="muted" style={{ fontSize: 12.5 }}>{it}</div>)}
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
                <span className="muted" style={{ minWidth: 64, fontFamily: "var(--mono)", fontSize: 11 }}>{it.time ?? ""}</span>
                <span>{ctx.tr(it.label)}</span>
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
            {arr<{ k: string; v: string }>(node, "entries").map((e, i) => (
              <React.Fragment key={i}><span className="k">{e.k}</span><span>{e.v}</span></React.Fragment>
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
          {n.children?.length ? "▸ " : "· "}{n.label}
          {n.children?.length ? <TreeNodes nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}
