"use client";

import React, { useState } from "react";
import type { WorldState } from "@particle/contracts";
import type { IngestResult } from "@particle/runtime-core";
import { t, type Lang } from "../lib/i18n";
import { text } from "./Renderer";

export type TraceRow = {
  n: number;
  eventType: string;
  significance: number;
  deliberated: boolean;
  provider?: string;
  intent?: string;
  morphApplied: boolean;
  capabilities: string[];
  guardReasonCodes: string[];
};

export type MemorySnapshot = {
  episodes: { context: string; summary: string }[];
  preferences: { key: string; weight: number }[];
  patterns: { key: string; count: number }[];
};

export type DebugState = {
  worldState?: WorldState;
  last?: IngestResult;
  traces: TraceRow[];
  audit: { id: string; kind: string; detail: Record<string, unknown> }[];
  memory?: MemorySnapshot;
};

type Tab = "trace" | "world" | "decision" | "memory" | "audit";

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

/**
 * One audit row, made safe to draw.
 *
 * The records shown here arrive two ways: from the local core, where they are typed, and over the
 * socket, where a frame's list is now checked entry by entry. This is the same discipline the
 * renderer applies next door — a value put on screen is bounded and is text, and a record that is
 * not a record is skipped rather than read for an id. The inspector is where a person goes to find
 * out why their body changed, so it is the last surface that should go blank.
 */
function auditRow(a: unknown, i: number): { key: string; kind: string; detail: string } | null {
  if (!a || typeof a !== "object") return null;
  const r = a as { id?: unknown; kind?: unknown; detail?: unknown };
  let detail = "";
  try {
    detail = text(JSON.stringify(r.detail ?? {}) ?? "");
  } catch {
    detail = "(cannot be shown)";
  }
  return { key: `${text(r.id, "record")}-${i}`, kind: text(r.kind, "record"), detail };
}

/**
 * The developer inspector (spec §31): a replayable window into why the interface changed —
 * event trace, world state, the structured decision, and the audit trail. Hidden in normal
 * use; toggled on for debugging.
 */
/**
 * `openOn` is which tab it starts on. It opens on the trace, and until now that was the only tab
 * anything had ever rendered: static markup lands where a component opens, so the world, decision,
 * memory and audit tabs were drawn only by a person clicking them.
 */
export function DeveloperInspector({ debug, lang = "en", openOn = "trace" }: { debug: DebugState; lang?: Lang; openOn?: Tab }) {
  const [tab, setTab] = useState<Tab>(openOn);
  const tabs: { id: Tab; label: string }[] = [
    { id: "trace", label: t("tabTrace", lang) },
    { id: "world", label: t("tabWorld", lang) },
    { id: "decision", label: t("tabDecision", lang) },
    { id: "memory", label: t("tabMemory", lang) },
    { id: "audit", label: t("tabAudit", lang) },
  ];

  return (
    <div className="devpanel">
      <div className="devtabs">
        {tabs.map((t) => (
          <button key={t.id} className={`devtab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trace" ? (
        <div className="devbody" tabIndex={0}>
          {debug.traces.length === 0 ? <span className="muted">No events yet.</span> : null}
          <table className="table">
            <thead>
              <tr><th>#</th><th>event</th><th>sig</th><th>brain</th><th>intent</th><th>morph</th><th>capabilities</th></tr>
            </thead>
            <tbody>
              {debug.traces.map((t) => (
                <tr key={t.n}>
                  <td>{t.n}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{t.eventType}</td>
                  <td>{Math.round(t.significance * 100)}%</td>
                  <td>{t.deliberated ? (t.provider ?? "—") : "reflex"}</td>
                  <td>{t.intent ?? "—"}</td>
                  <td>{t.morphApplied ? "✓" : t.guardReasonCodes.length ? t.guardReasonCodes[0] : "—"}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{t.capabilities.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "world" ? (
        <div className="devbody" tabIndex={0}>
          <pre className="code" tabIndex={0}>{debug.worldState ? pretty({
            activeContext: debug.worldState.activeContext,
            activeProblems: debug.worldState.activeProblems,
            environment: debug.worldState.environment,
            attention: debug.worldState.attention,
            autonomy: debug.worldState.autonomy,
          }) : "no world state yet"}</pre>
        </div>
      ) : null}

      {tab === "decision" ? (
        <div className="devbody" tabIndex={0}>
          <pre className="code" tabIndex={0}>{debug.last?.decision ? pretty({
            id: debug.last.decision.id,
            route: debug.last.route,
            usedFallback: debug.last.usedFallback,
            uiPlan: debug.last.decision.uiPlan,
            capabilityPlan: debug.last.decision.capabilityPlan,
            autonomyRequirement: debug.last.decision.autonomyRequirement,
            reasonSummary: debug.last.decision.reasonSummary,
          }) : "no decision yet (emit a significant event)"}</pre>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="devbody" tabIndex={0}>
          {!debug.memory || (!debug.memory.episodes.length && !debug.memory.preferences.length && !debug.memory.patterns.length) ? (
            <span className="muted">{t("memNone", lang)}</span>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div className="panel-title"><span>{t("memEpisodic", lang)}</span></div>
                {debug.memory.episodes.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : null}
                {debug.memory.episodes.map((e, i) => (
                  <div key={i} style={{ fontSize: 12.5 }}>
                    <span className="badge" style={{ marginRight: 6 }}><span className="dot" />{e.context}</span>
                    <span className="muted">{e.summary}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="panel-title"><span>{t("memPreferences", lang)}</span></div>
                <div className="reasons">
                  {debug.memory.preferences.map((p) => (
                    <span key={p.key} className="tag">{p.key} ·{p.weight}</span>
                  ))}
                  {debug.memory.preferences.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : null}
                </div>
              </div>
              <div>
                <div className="panel-title"><span>{t("memPatterns", lang)}</span></div>
                <div className="reasons">
                  {debug.memory.patterns.map((p) => (
                    <span key={p.key} className="tag">{p.key} ·{p.count}×</span>
                  ))}
                  {debug.memory.patterns.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>none yet (repeat a flow to reach the threshold)</span> : null}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {tab === "audit" ? (
        <div className="devbody" tabIndex={0}>
          {debug.audit.length === 0 ? <span className="muted">No audit records yet.</span> : null}
          <div className="stack" style={{ gap: 4 }}>
            {debug.audit.map((a, i) => auditRow(a, i)).map((row) =>
              row ? (
                <div key={row.key} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                  <span className="badge" style={{ marginRight: 6 }}><span className="dot" />{row.kind}</span>
                  {row.detail}
                </div>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
