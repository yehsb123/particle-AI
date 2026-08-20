"use client";

import React, { useState } from "react";
import type { WorldState } from "@particle/contracts";
import type { IngestResult } from "@particle/runtime-core";

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
 * The developer inspector (spec §31): a replayable window into why the interface changed —
 * event trace, world state, the structured decision, and the audit trail. Hidden in normal
 * use; toggled on for debugging.
 */
export function DeveloperInspector({ debug }: { debug: DebugState }) {
  const [tab, setTab] = useState<Tab>("trace");
  const tabs: { id: Tab; label: string }[] = [
    { id: "trace", label: "Event trace" },
    { id: "world", label: "World state" },
    { id: "decision", label: "Decision" },
    { id: "memory", label: "Memory" },
    { id: "audit", label: "Audit" },
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
        <div className="devbody">
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
        <div className="devbody">
          <pre className="code">{debug.worldState ? pretty({
            activeContext: debug.worldState.activeContext,
            activeProblems: debug.worldState.activeProblems,
            environment: debug.worldState.environment,
            attention: debug.worldState.attention,
            autonomy: debug.worldState.autonomy,
          }) : "no world state yet"}</pre>
        </div>
      ) : null}

      {tab === "decision" ? (
        <div className="devbody">
          <pre className="code">{debug.last?.decision ? pretty({
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
        <div className="devbody">
          {!debug.memory || (!debug.memory.episodes.length && !debug.memory.preferences.length && !debug.memory.patterns.length) ? (
            <span className="muted">No experience yet — emit a few events.</span>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div className="panel-title"><span>Episodic</span></div>
                {debug.memory.episodes.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : null}
                {debug.memory.episodes.map((e, i) => (
                  <div key={i} style={{ fontSize: 12.5 }}>
                    <span className="badge" style={{ marginRight: 6 }}><span className="dot" />{e.context}</span>
                    <span className="muted">{e.summary}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="panel-title"><span>Preferences (reinforced)</span></div>
                <div className="reasons">
                  {debug.memory.preferences.map((p) => (
                    <span key={p.key} className="tag">{p.key} ·{p.weight}</span>
                  ))}
                  {debug.memory.preferences.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : null}
                </div>
              </div>
              <div>
                <div className="panel-title"><span>Pattern candidates (reusable-template suggestions)</span></div>
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
        <div className="devbody">
          {debug.audit.length === 0 ? <span className="muted">No audit records yet.</span> : null}
          <div className="stack" style={{ gap: 4 }}>
            {debug.audit.map((a) => (
              <div key={a.id} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                <span className="badge" style={{ marginRight: 6 }}><span className="dot" />{a.kind}</span>
                {JSON.stringify(a.detail)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
