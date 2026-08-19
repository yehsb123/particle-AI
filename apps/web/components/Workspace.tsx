"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { AttentionState, MatterEvent, UIAction, UIBlueprint } from "@dm/contracts";
import { developmentBlueprint } from "@dm/ui-registry";
import { applyPatch, guardPatch, MorphHistory, DEFAULT_MORPH_POLICY } from "@dm/morph-engine";
import { Render, RendererProvider } from "./Renderer";
import { decide } from "../lib/decide";
import { SIM_EVENTS, buildEvent, type SimSpec } from "../lib/sim";

type Presence = "idle" | "observing" | "evaluating" | "acting" | "waiting_for_approval";

type LogEntry = { id: string; text: string; kind: "event" | "morph" | "blocked" | "undo" | "note" };

type InspectorState = {
  lastEvent?: string;
  decisionId?: string;
  reasonSummary?: string;
  confidence?: number;
  reasonCodes: string[];
  dropped: string[];
  applied: boolean;
};

const SESSION = "session-local";

function nowIso() {
  return new Date().toISOString();
}

export function Workspace() {
  const [blueprint, setBlueprint] = useState<UIBlueprint>(() => developmentBlueprint(nowIso()));
  const [attention, setAttention] = useState<AttentionState>({ typing: false });
  const [presence, setPresence] = useState<Presence>("observing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inspector, setInspector] = useState<InspectorState>({ reasonCodes: [], dropped: [], applied: false });
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");

  const history = useRef(new MorphHistory());
  const counter = useRef(0);
  const lastMorphAt = useRef<number | undefined>(undefined);
  const lastMajorMorphAt = useRef<number | undefined>(undefined);
  const [canUndo, setCanUndo] = useState(false);

  const nextId = () => `e${++counter.current}`;

  const pushLog = useCallback((text: string, kind: LogEntry["kind"]) => {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, 40));
  }, []);

  const ingest = useCallback(
    (event: MatterEvent) => {
      pushLog(`${event.type} · ${event.severity}`, "event");
      setPresence("evaluating");

      const decision = decide(event, blueprint);
      if (!decision) {
        setPresence("observing");
        setInspector({ lastEvent: event.type, reasonCodes: ["not_significant"], dropped: [], applied: false });
        pushLog(`no morph — ${event.type} not significant to the current context`, "note");
        return;
      }

      setPresence("acting");
      const policy = decision.deEscalation
        ? { ...DEFAULT_MORPH_POLICY, majorDwellMs: 0 }
        : DEFAULT_MORPH_POLICY;

      const guard = guardPatch({
        currentUI: blueprint,
        desiredPatch: decision.patch,
        attention,
        confidence: decision.confidence,
        severity: decision.severity,
        now: Date.now(),
        lastMorphAt: lastMorphAt.current,
        lastMajorMorphAt: lastMajorMorphAt.current,
        policy,
      });

      const dropped = guard.dropped.map((d) => `${d.op.op}:${d.reason}`);

      if (!guard.allowed) {
        setPresence("observing");
        setInspector({
          lastEvent: event.type,
          decisionId: decision.decisionId,
          reasonSummary: decision.reasonSummary,
          confidence: decision.confidence,
          reasonCodes: guard.reasonCodes,
          dropped,
          applied: false,
        });
        pushLog(`morph blocked by guard — ${guard.reasonCodes.join(", ")}`, "blocked");
        return;
      }

      const { next, inverse } = applyPatch(blueprint, guard.patch, nowIso());
      history.current.push(inverse);
      setCanUndo(true);
      setBlueprint(next);
      const t = Date.now();
      lastMorphAt.current = t;
      if (decision.major && !decision.deEscalation) lastMajorMorphAt.current = t;

      setInspector({
        lastEvent: event.type,
        decisionId: decision.decisionId,
        reasonSummary: decision.reasonSummary,
        confidence: decision.confidence,
        reasonCodes: guard.reasonCodes,
        dropped,
        applied: true,
      });
      pushLog(`UI morphed → ${decision.deEscalation ? "recovery" : decision.patch.patchId}`, "morph");
      setTimeout(() => setPresence("observing"), 600);
    },
    [blueprint, attention, pushLog],
  );

  const emitSim = (spec: SimSpec) => ingest(buildEvent(spec, SESSION, nextId(), nowIso()));

  const undo = useCallback(() => {
    const inverse = history.current.pop();
    if (!inverse) return;
    const { next } = applyPatch(blueprint, inverse, nowIso());
    setBlueprint(next);
    setCanUndo(history.current.canUndo);
    lastMorphAt.current = Date.now();
    pushLog("undo — reverted last morph", "undo");
    setInspector((i) => ({ ...i, applied: false, reasonCodes: ["undone"] }));
  }, [blueprint, pushLog]);

  const rendererCtx = useMemo(
    () => ({
      emitAction: (action: UIAction) => {
        if (action.event === "user.requested_undo") {
          undo();
          return;
        }
        pushLog(`action — ${action.capabilityId ?? action.event}`, "note");
        setInspector((i) => ({ ...i, reasonCodes: [`action:${action.capabilityId ?? action.event}`] }));
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
            Digital Matter <small>adaptive runtime · Phase 1</small>
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
      </main>

      <aside className="rail">
        <section>
          <h3>Simulation lab</h3>
          <div className="simrow">
            {SIM_EVENTS.map((s) => (
              <button key={s.label} className="btn" onClick={() => emitSim(s)}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            You never ask for a dashboard. Emit an event and watch the runtime decide whether
            it matters and reshape its own body.
          </p>
        </section>

        <section>
          <h3>Controls</h3>
          <div className="simrow">
            <button className="btn" onClick={undo} disabled={!canUndo}>Undo last morph</button>
            <button className="btn muted" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>
              Theme: {theme}
            </button>
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">mode</span><span>{blueprint.mode}</span>
            <span className="k">workspace</span><span>{blueprint.workspaceId}</span>
            <span className="k">focus</span><span>{attention.focusedComponentId ?? "—"}{attention.typing ? " (typing)" : ""}</span>
          </div>
        </section>

        <section>
          <h3>Inspector — why did the UI change?</h3>
          <div className="kv">
            <span className="k">event</span><span>{inspector.lastEvent ?? "—"}</span>
            <span className="k">decision</span><span>{inspector.decisionId ?? "—"}</span>
            <span className="k">confidence</span><span>{inspector.confidence !== undefined ? `${Math.round(inspector.confidence * 100)}%` : "—"}</span>
            <span className="k">applied</span><span>{inspector.applied ? "yes" : "no"}</span>
          </div>
          {inspector.reasonSummary ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{inspector.reasonSummary}</p>
          ) : null}
          {inspector.reasonCodes.length ? (
            <div className="reasons" style={{ marginTop: 8 }}>
              {inspector.reasonCodes.map((r) => <span key={r} className="tag">{r}</span>)}
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
