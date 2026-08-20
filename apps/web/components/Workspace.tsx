"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { AttentionState, MatterEvent, UIAction, UIBlueprint } from "@dm/contracts";
import { createRuntimeCore, type IngestResult, type RuntimeCore } from "@dm/runtime-core";
import { Render, RendererProvider } from "./Renderer";
import { DeveloperInspector, type DebugState } from "./DeveloperInspector";
import { SIM_EVENTS, buildEvent, type SimSpec } from "../lib/sim";

type Presence = "idle" | "observing" | "evaluating" | "acting" | "waiting_for_approval";
type LogEntry = { id: string; text: string; kind: "event" | "morph" | "blocked" | "undo" | "note" };

type Inspector = {
  lastEvent?: string;
  significance?: number;
  deliberated?: boolean;
  provider?: string;
  usedFallback?: boolean;
  reasonSummary?: string;
  confidence?: number;
  capabilities: string[];
  permission?: { authorized: string[]; needsApproval: string[]; denied: string[] };
  morphApplied?: boolean;
  guardReasonCodes: string[];
  dropped: string[];
};

const SESSION = "session-local";
const nowIso = () => new Date().toISOString();

export function Workspace() {
  const core = useRef<RuntimeCore>(createRuntimeCore({ iso: nowIso, ms: () => Date.now() }));
  const [blueprint, setBlueprint] = useState<UIBlueprint>(() => core.current.getBlueprint(SESSION));
  const [attention, setAttention] = useState<AttentionState>({ typing: false });
  const [presence, setPresence] = useState<Presence>("observing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inspector, setInspector] = useState<Inspector>({ capabilities: [], guardReasonCodes: [], dropped: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");
  const [devMode, setDevMode] = useState(false);
  const [debug, setDebug] = useState<DebugState>({ traces: [], audit: [] });
  const counter = useRef(0);

  const pushLog = useCallback((text: string, kind: LogEntry["kind"]) => {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, 40));
  }, []);

  const applyResult = useCallback(
    (res: IngestResult) => {
      setBlueprint(res.blueprint);
      setPresence(res.presence as Presence);
      setCanUndo(core.current.canUndo(SESSION));
      setInspector({
        significance: res.significance.score,
        deliberated: res.deliberated,
        provider: res.providerId,
        usedFallback: res.usedFallback,
        reasonSummary: res.decision?.reasonSummary,
        confidence: res.decision?.uiPlan?.confidence,
        capabilities: res.capabilityRuns.map((r) => r.capabilityId),
        permission: res.permission
          ? {
              authorized: res.permission.authorized.map((i) => i.capabilityId),
              needsApproval: res.permission.needsApproval.map((i) => i.capabilityId),
              denied: res.permission.denied.map((i) => i.capabilityId),
            }
          : undefined,
        morphApplied: res.morph.applied,
        guardReasonCodes: res.morph.guardReasonCodes,
        dropped: res.morph.dropped,
      });
      setDebug((d) => ({
        worldState: res.worldState,
        last: res,
        traces: [
          ...d.traces,
          {
            n: d.traces.length + 1,
            eventType: res.worldState.recentEvents.at(-1)?.type ?? "event",
            significance: res.significance.score,
            deliberated: res.deliberated,
            provider: res.providerId,
            intent: res.decision?.uiPlan?.intent,
            morphApplied: res.morph.applied,
            capabilities: res.capabilityRuns.map((r) => r.capabilityId),
            guardReasonCodes: res.morph.guardReasonCodes,
          },
        ].slice(-50),
        audit: [...res.audit.map((a) => ({ id: a.id, kind: a.kind, detail: a.detail })), ...d.audit].slice(0, 60),
      }));
    },
    [],
  );

  const ingest = useCallback(
    async (event: MatterEvent) => {
      pushLog(`${event.type} · ${event.severity}`, "event");
      setPresence("evaluating");
      const res = await core.current.ingest(event, attention);
      applyResult(res);
      if (!res.deliberated) pushLog(`no morph — ${event.type} not significant`, "note");
      else if (res.morph.applied) pushLog(`UI morphed → ${res.morph.patch?.patchId ?? "patch"} (${res.capabilityRuns.length} capabilities ran)`, "morph");
      else pushLog(`morph blocked — ${res.morph.guardReasonCodes.join(", ") || "no change"}`, "blocked");
      if (res.presence === "acting") setTimeout(() => setPresence("observing"), 600);
    },
    [attention, applyResult, pushLog],
  );

  const emitSim = (spec: SimSpec) => {
    void ingest(buildEvent(spec, SESSION, `e${++counter.current}`, nowIso()));
  };

  const undo = useCallback(() => {
    const bp = core.current.undo(SESSION);
    if (!bp) return;
    setBlueprint(bp);
    setCanUndo(core.current.canUndo(SESSION));
    pushLog("undo — reverted last morph", "undo");
  }, [pushLog]);

  const rendererCtx = useMemo(
    () => ({
      emitAction: (action: UIAction) => {
        if (action.event === "user.requested_undo") return undo();
        pushLog(`action — ${action.capabilityId ?? action.event}`, "note");
      },
      setFocus: (id: string) => setAttention({ typing: true, focusedComponentId: id, lastInteractionAt: nowIso() }),
      clearFocus: () => setAttention({ typing: false }),
    }),
    [undo, pushLog],
  );

  const applyTheme = (t: "system" | "dark" | "light") => {
    setTheme(t);
    const el = document.documentElement;
    if (t === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", t);
  };

  return (
    <div className="app">
      <main className="stage">
        <div className="brandbar">
          <div className="brand">
            Particle AI <small>adaptive runtime · integrated loop</small>
          </div>
          <div className="presence" data-state={presence}>
            <span className="orb" />
            <span className="muted">AI · {presence}</span>
          </div>
        </div>
        <div style={{ paddingTop: 16 }}>
          <RendererProvider value={rendererCtx}>
            <Render node={blueprint.root} />
          </RendererProvider>
        </div>
        {devMode ? (
          <div style={{ paddingTop: 16 }}>
            <DeveloperInspector debug={debug} />
          </div>
        ) : null}
      </main>

      <aside className="rail">
        <section>
          <h3>Simulation lab</h3>
          <div className="simrow">
            {SIM_EVENTS.map((s) => (
              <button key={s.label} className="btn" onClick={() => emitSim(s)}>{s.label}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            You never ask for a dashboard. Emit an event; the runtime judges significance, decides,
            runs read-only capabilities, and reshapes its own body — reversibly.
          </p>
        </section>

        <section>
          <h3>Controls</h3>
          <div className="simrow">
            <button className="btn" onClick={undo} disabled={!canUndo}>Undo last morph</button>
            <button className="btn muted" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>Theme: {theme}</button>
            <button className={`btn${devMode ? " primary" : " muted"}`} onClick={() => setDevMode((v) => !v)}>Developer mode</button>
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">mode</span><span>{blueprint.mode}</span>
            <span className="k">focus</span><span>{attention.focusedComponentId ?? "—"}{attention.typing ? " (typing)" : ""}</span>
          </div>
        </section>

        <section>
          <h3>Inspector — why did the UI change?</h3>
          <div className="kv">
            <span className="k">significance</span><span>{inspector.significance !== undefined ? `${Math.round(inspector.significance * 100)}%` : "—"}</span>
            <span className="k">deliberated</span><span>{inspector.deliberated ? "yes" : "no"}</span>
            <span className="k">provider</span><span>{inspector.provider ?? "—"}{inspector.usedFallback ? " (fallback)" : ""}</span>
            <span className="k">confidence</span><span>{inspector.confidence !== undefined ? `${Math.round(inspector.confidence * 100)}%` : "—"}</span>
            <span className="k">morph</span><span>{inspector.morphApplied ? "applied" : "none"}</span>
          </div>
          {inspector.reasonSummary ? <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{inspector.reasonSummary}</p> : null}
          {inspector.capabilities.length ? (
            <div className="reasons" style={{ marginTop: 8 }}>
              {inspector.capabilities.map((c) => <span key={c} className="tag">ran·{c}</span>)}
            </div>
          ) : null}
          {inspector.permission?.needsApproval.length ? (
            <div className="reasons" style={{ marginTop: 8 }}>
              {inspector.permission.needsApproval.map((c) => <span key={c} className="tag">approval·{c}</span>)}
            </div>
          ) : null}
          {inspector.guardReasonCodes.length ? (
            <div className="reasons" style={{ marginTop: 8 }}>
              {inspector.guardReasonCodes.map((r) => <span key={r} className="tag">{r}</span>)}
            </div>
          ) : null}
          {inspector.dropped.length ? (
            <div className="reasons" style={{ marginTop: 8 }}>
              {inspector.dropped.map((d) => <span key={d} className="tag">dropped·{d}</span>)}
            </div>
          ) : null}
        </section>

        <section>
          <h3>Event / morph log</h3>
          <div className="stack" style={{ gap: 4 }}>
            {log.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>No events yet.</span> : null}
            {log.map((e) => (
              <div key={e.id} style={{ fontSize: 12, fontFamily: "var(--mono)" }}>
                <span className={e.kind === "blocked" ? "badge crit" : e.kind === "morph" ? "badge ok" : "badge"} style={{ marginRight: 6 }}>
                  <span className="dot" />{e.kind}
                </span>
                {e.text}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
