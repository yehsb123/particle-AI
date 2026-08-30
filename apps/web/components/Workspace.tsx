"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequest, AttentionState, AutonomyLevel, MatterEvent, UIAction, UIBlueprint } from "@particle/contracts";
import { MatterEvent as MatterEventSchema } from "@particle/contracts";
import { createRuntimeCore, replay, type IngestResult, type RuntimeCore } from "@particle/runtime-core";
import { Render, RendererProvider } from "./Renderer";
import { DeveloperInspector, type DebugState } from "./DeveloperInspector";
import { SIM_EVENTS, buildEvent, type SimSpec } from "../lib/sim";
import { RuntimeClient, type ServerMessage } from "../lib/runtimeClient";
import { t, tr, type Lang } from "../lib/i18n";

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
  // Lazy, once-only construction — useRef's initializer must not re-run the factory each render.
  const core = useRef<RuntimeCore>(undefined as unknown as RuntimeCore);
  if (!core.current) core.current = createRuntimeCore({ iso: nowIso, ms: () => Date.now() });
  const [blueprint, setBlueprint] = useState<UIBlueprint>(() => core.current.getBlueprint(SESSION));
  const [attention, setAttention] = useState<AttentionState>({ typing: false });
  const [presence, setPresence] = useState<Presence>("observing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inspector, setInspector] = useState<Inspector>({ capabilities: [], guardReasonCodes: [], dropped: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");
  const [lang, setLang] = useState<Lang>("en");
  const [showCoach, setShowCoach] = useState(false);
  const [showPresence, setShowPresence] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [debug, setDebug] = useState<DebugState>({ traces: [], audit: [] });
  const [mode, setMode] = useState<"local" | "connected">("local");
  const [connected, setConnected] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [patternSugs, setPatternSugs] = useState<{ key: string; count: number }[]>([]);
  const [events, setEvents] = useState<MatterEvent[]>([]);
  const [replayResult, setReplayResult] = useState<"identical" | "differs" | "none" | null>(null);
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(2);
  const client = useRef<RuntimeClient | null>(null);
  const counter = useRef(0);

  const addApprovals = useCallback((incoming: ApprovalRequest[]) => {
    if (!incoming?.length) return;
    setApprovals((a) => {
      const ids = new Set(a.map((x) => x.id));
      return [...a, ...incoming.filter((x) => !ids.has(x.id))];
    });
  }, []);

  const pushLog = useCallback((text: string, kind: LogEntry["kind"]) => {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, 40));
  }, []);

  const applyResult = useCallback(
    (res: IngestResult) => {
      setBlueprint(res.blueprint);
      setPresence(res.presence as Presence);
      setCanUndo(core.current.canUndo(SESSION));
      addApprovals(res.pendingApprovals);
      if (res.patternSuggestions.length) {
        setPatternSugs((p) => [
          ...p,
          ...res.patternSuggestions
            .filter((s) => !p.some((x) => x.key === s.key))
            .map((s) => ({ key: s.key, count: s.count })),
        ]);
      }
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
        memory: (() => {
          const mem = core.current.memoryFor(SESSION);
          return {
            episodes: mem.episodic.recent(6).map((e) => ({ context: e.context, summary: e.summary })),
            preferences: mem.preferences.top(6),
            patterns: mem.patterns.candidates().map((c) => ({ key: c.key, count: c.count })),
          };
        })(),
      }));
    },
    [addApprovals],
  );

  const ingest = useCallback(
    async (event: MatterEvent) => {
      pushLog(`${event.type} · ${event.severity}`, "event");
      setPresence("evaluating");
      setEvents((e) => {
        const next = [...e, event];
        try { localStorage.setItem("dm_events", JSON.stringify(next)); } catch {}
        return next;
      });
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
    if (mode === "connected" && client.current) {
      pushLog(`${spec.type} · ${spec.severity} → server`, "event");
      setPresence("evaluating");
      void client.current.emitSim(spec.key).then((resp) => {
        if (resp?.pendingApprovals) addApprovals(resp.pendingApprovals);
      });
      return;
    }
    void ingest(buildEvent(spec, SESSION, `e${++counter.current}`, nowIso()));
  };

  const decideApproval = useCallback(
    async (approval: ApprovalRequest, accept: boolean) => {
      if (mode === "connected" && client.current) {
        await (accept ? client.current.approve(approval.id) : client.current.reject(approval.id));
      } else if (accept) {
        const outcome = await core.current.approve(approval.id);
        pushLog(`approved ${approval.capabilityId} → ${outcome?.result.ok ? "executed" : "failed"}`, outcome?.result.ok ? "morph" : "blocked");
      } else {
        core.current.reject(approval.id);
        pushLog(`rejected ${approval.capabilityId}`, "note");
      }
      setApprovals((a) => a.filter((x) => x.id !== approval.id));
    },
    [mode, pushLog],
  );

  const undo = useCallback(() => {
    if (mode === "connected" && client.current) {
      void client.current.undo();
      pushLog("undo → server", "undo");
      return;
    }
    const bp = core.current.undo(SESSION);
    if (!bp) return;
    setBlueprint(bp);
    setCanUndo(core.current.canUndo(SESSION));
    pushLog("undo — reverted last morph", "undo");
  }, [mode, pushLog]);

  const handleServerMessage = useCallback(
    (m: ServerMessage) => {
      if (m.kind === "ui_patch") {
        setBlueprint(m.blueprint);
        setCanUndo(true);
        setPresence("acting");
        pushLog("server morph → ui_patch", "morph");
        setTimeout(() => setPresence("observing"), 600);
      } else if (m.kind === "world_state_changed") {
        setDebug((d) => ({ ...d, worldState: m.worldState }));
      } else if (m.kind === "ai_presence_changed") {
        setPresence(m.state as Presence);
      } else if (m.kind === "decision_created") {
        setDebug((d) => ({ ...d, audit: [...m.audit, ...d.audit].slice(0, 60) }));
        pushLog("server decision", "note");
      }
    },
    [pushLog],
  );

  const toggleMode = useCallback(async () => {
    // approvals/audit are per-runtime; clear cross-mode state when switching runtimes.
    setApprovals([]);
    if (mode === "local") {
      const c = new RuntimeClient(SESSION);
      client.current = c;
      c.connect(handleServerMessage, setConnected);
      try {
        setBlueprint(await c.getUI());
      } catch {
        pushLog("could not reach runtime server (pnpm runtime)", "blocked");
      }
      setMode("connected");
    } else {
      client.current?.disconnect();
      client.current = null;
      setConnected(false);
      setMode("local");
      setBlueprint(core.current.getBlueprint(SESSION));
      pushLog("switched to local runtime", "note");
    }
  }, [mode, handleServerMessage, pushLog]);

  const rendererCtx = useMemo(
    () => ({
      emitAction: (action: UIAction) => {
        if (action.event === "user.requested_undo") return undo();
        pushLog(`action — ${action.capabilityId ?? action.event}`, "note");
      },
      setFocus: (id: string) => setAttention({ typing: true, focusedComponentId: id, lastInteractionAt: nowIso() }),
      clearFocus: () => setAttention({ typing: false }),
      tr: (s: string) => tr(s, lang),
    }),
    [undo, pushLog, lang],
  );

  // Spec §21: replay the session's event log through a fresh core and check determinism.
  const replayVerify = useCallback(async () => {
    if (events.length === 0) return setReplayResult("none");
    const { core: fresh } = await replay(events, { iso: nowIso, ms: () => Date.now() });
    const same = JSON.stringify(fresh.getBlueprint(SESSION).root) === JSON.stringify(core.current.getBlueprint(SESSION).root);
    setReplayResult(same ? "identical" : "differs");
    pushLog(same ? "replay ✓ deterministic" : "replay differs (undo/approval not events)", same ? "morph" : "note");
  }, [events, pushLog]);

  const applyTheme = (t: "system" | "dark" | "light") => {
    setTheme(t);
    const el = document.documentElement;
    if (t === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", t);
    try { localStorage.setItem("dm_theme", t); } catch {}
  };

  const dismissCoach = () => {
    setShowCoach(false);
    try { localStorage.setItem("dm_coach", "dismissed"); } catch {}
  };
  const dismissCoachRef = useRef(dismissCoach);
  dismissCoachRef.current = dismissCoach;

  // Tear down the WebSocket if the component unmounts while connected (no leaked socket/state).
  useEffect(() => () => {
    client.current?.disconnect();
    client.current = null;
  }, []);

  // Restore saved preferences (language, theme, coach) on mount — no SSR mismatch.
  useEffect(() => {
    try {
      const sl = localStorage.getItem("dm_lang");
      if (sl === "ko" || sl === "en") setLang(sl);
      const st = localStorage.getItem("dm_theme");
      if (st === "dark" || st === "light" || st === "system") {
        setTheme(st);
        const el = document.documentElement;
        if (st === "system") el.removeAttribute("data-theme");
        else el.setAttribute("data-theme", st);
      }
      setShowCoach(localStorage.getItem("dm_coach") !== "dismissed");

      // Event sourcing in the browser: replay the saved event log so the workspace survives a
      // refresh. Only validated events are replayed; undo/approvals are not events (by design).
      const raw = localStorage.getItem("dm_events");
      if (raw) {
        const parsed = (JSON.parse(raw) as unknown[]).map((x) => MatterEventSchema.safeParse(x)).filter((r) => r.success).map((r) => r.data);
        if (parsed.length) {
          void (async () => {
            let last: IngestResult | undefined;
            for (const ev of parsed) last = await core.current.ingest(ev);
            if (last) applyResult(last);
            setEvents(parsed);
            counter.current = parsed.length;
            pushLog(t("restoredNote", lang), "note");
          })();
        }
      }
    } catch {
      setShowCoach(true);
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("dm_lang", lang); } catch {}
  }, [lang]);

  // Escape closes transient surfaces (presence popover first, then the coach).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShowPresence((open) => {
        if (open) return false;
        dismissCoachRef.current();
        return open;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <main className="stage">
        <div className="brandbar">
          <div className="brand">
            <svg viewBox="0 0 32 32" aria-hidden>
              <defs>
                <radialGradient id="pcore" cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="#D0BCFF" />
                  <stop offset="60%" stopColor="#7F67BE" />
                  <stop offset="100%" stopColor="#4F378B" />
                </radialGradient>
              </defs>
              <rect width="32" height="32" rx="7" fill="#21005D" />
              <ellipse cx="16" cy="16" rx="12" ry="5" fill="none" stroke="#B69DF8" strokeWidth="1.4" opacity="0.55" transform="rotate(-28 16 16)" />
              <circle cx="16" cy="16" r="6" fill="url(#pcore)" />
              <circle cx="26.5" cy="10.5" r="2.1" fill="#D0BCFF" />
            </svg>
            Particle AI <small>{t("tagline", lang)}</small>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <a className="btn muted" style={{ padding: "6px 14px", textDecoration: "none" }} href="/pitch.html" target="_blank" rel="noreferrer">
              {lang === "ko" ? "소개" : "About"}
            </a>
            <button
              className="btn primary"
              style={{ padding: "6px 14px" }}
              onClick={() => setLang((l) => (l === "en" ? "ko" : "en"))}
              title="Language / 언어"
            >
              🌐 {t("langButton", lang)}
            </button>
            <div style={{ position: "relative" }}>
              <button
                className="presence"
                data-state={presence}
                onClick={() => setShowPresence((v) => !v)}
                aria-expanded={showPresence}
                title={t("presenceTitle", lang)}
                style={{ cursor: "pointer", font: "inherit" }}
              >
                <span className="orb" />
                <span className="muted">AI · {t(presence, lang)}</span>
              </button>
              {showPresence ? (
                <div className="presence-pop" role="dialog" aria-label={t("presenceTitle", lang)}>
                  <div className="panel-title" style={{ marginBottom: 10 }}>
                    <span>{t("presenceTitle", lang)}</span>
                    <button className="btn muted" style={{ padding: "2px 10px" }} onClick={() => setShowPresence(false)}>✕</button>
                  </div>
                  <div className="kv">
                    <span className="k">{t("presenceState", lang)}</span><span>{t(presence, lang)}</span>
                    <span className="k">{t("presenceWatching", lang)}</span><span>{t("presenceWatchingValue", lang)}</span>
                    <span className="k">{t("presenceAutonomy", lang)}</span><span>L{autonomy}</span>
                  </div>
                  <div className="divider" style={{ margin: "10px 0" }} />
                  <div className="k muted" style={{ fontSize: 12 }}>{t("presenceLastReason", lang)}</div>
                  <p style={{ fontSize: 13, margin: "6px 0 0" }}>
                    {inspector.reasonSummary ?? t("presenceNoReason", lang)}
                  </p>
                  <div className="divider" style={{ margin: "10px 0" }} />
                  <div className="k muted" style={{ fontSize: 12 }}>{t("presencePlanned", lang)}</div>
                  <p style={{ fontSize: 13, margin: "6px 0 0", fontFamily: approvals.length ? "var(--mono)" : undefined }}>
                    {approvals.length ? approvals.map((a) => a.capabilityId).join(", ") : t("presenceNothingPlanned", lang)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {showCoach ? (
          <div className="coach">
            <span>{t("coachText", lang)}</span>
            <button className="btn" onClick={dismissCoach}>{t("coachDismiss", lang)}</button>
          </div>
        ) : null}
        <div style={{ paddingTop: 16 }}>
          <RendererProvider value={rendererCtx}>
            <Render node={blueprint.root} />
          </RendererProvider>
        </div>
        {devMode ? (
          <div style={{ paddingTop: 16 }}>
            <div className="simrow" style={{ alignItems: "center", marginBottom: 10 }}>
              <button className="btn" onClick={() => void replayVerify()}>{t("replayBtn", lang)}</button>
              {replayResult ? (
                <span className={`badge ${replayResult === "identical" ? "ok" : replayResult === "differs" ? "warn" : ""}`}>
                  <span className="dot" />
                  {replayResult === "identical" ? t("replayIdentical", lang) : replayResult === "differs" ? t("replayDiffers", lang) : t("replayNone", lang)}
                </span>
              ) : null}
            </div>
            <DeveloperInspector debug={debug} lang={lang} />
          </div>
        ) : null}
      </main>

      <aside className="rail">
        <section>
          <h3>{t("simLab", lang)}</h3>
          <div className="simrow">
            {SIM_EVENTS.map((s) => (
              <button key={s.label} className="btn" onClick={() => emitSim(s)}>{tr(s.label, lang)}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("simIntro", lang)}</p>
        </section>

        <section>
          <h3>{t("controls", lang)}</h3>
          <div className="simrow">
            <button className="btn" onClick={undo} disabled={!canUndo}>{t("undo", lang)}</button>
            <button className="btn muted" onClick={() => { try { localStorage.removeItem("dm_events"); } catch {} window.location.reload(); }}>{t("resetSession", lang)}</button>
            <button className="btn muted" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>{t("theme", lang)}: {theme}</button>
            <button className={`btn${devMode ? " primary" : " muted"}`} onClick={() => setDevMode((v) => !v)}>{t("devMode", lang)}</button>
            <button className={`btn${mode === "connected" ? " primary" : ""}`} onClick={() => void toggleMode()}>
              {t("runtime", lang)}: {mode === "connected" ? (connected ? "server ●" : "server ○") : "local"}
            </button>
          </div>
          {mode === "connected" ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("connectedNote", lang)}</p>
          ) : null}
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">{t("mode", lang)}</span><span>{tr(blueprint.mode, lang)}</span>
            <span className="k">{t("focus", lang)}</span><span>{attention.focusedComponentId ?? "—"}{attention.typing ? " (typing)" : ""}</span>
            <span className="k">{t("autonomy", lang)}</span>
            <span>
              <select
                className="select"
                style={{ width: "auto", padding: "4px 8px" }}
                value={autonomy}
                onChange={(e) => {
                  const n = Number(e.target.value) as AutonomyLevel;
                  setAutonomy(n);
                  core.current.setAutonomyLevel(n);
                  if (mode === "connected" && client.current) void client.current.setAutonomy(n);
                  pushLog(`autonomy level → L${n}${mode === "connected" ? " (server)" : ""}`, "note");
                }}
              >
                <option value={0}>L0 · manual</option>
                <option value={1}>L1 · suggestive</option>
                <option value={2}>L2 · adaptive UI</option>
                <option value={3}>L3 · assisted</option>
                <option value={4}>L4 · autonomous</option>
              </select>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{t("autonomyHint", lang)}</p>
        </section>

        {patternSugs.length ? (
          <section style={{ background: "var(--accent-low)" }}>
            <h3>{t("patternTitle", lang)}</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>{t("patternText", lang)}</p>
            <div className="stack" style={{ gap: 8 }}>
              {patternSugs.map((s) => (
                <div key={s.key} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{s.key} · {s.count}{t("patternTimes", lang)}</span>
                  <button className="btn muted" style={{ padding: "4px 12px" }} onClick={() => setPatternSugs((p) => p.filter((x) => x.key !== s.key))}>
                    {t("patternLater", lang)}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {approvals.length ? (
          <section style={{ background: "var(--warn-bg)" }}>
            <h3>{t("approvalTitle", lang)}</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>{t("approvalNote", lang)}</p>
            <div className="stack" style={{ gap: 10 }}>
              {approvals.map((a) => (
                <div key={a.id} className="card">
                  <div className="panel-title" style={{ marginBottom: 6 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{a.capabilityId}</span>
                    <span className="badge crit"><span className="dot" />{a.risk}</span>
                  </div>
                  <div className="simrow">
                    <button className="btn primary" onClick={() => void decideApproval(a, true)}>{t("approve", lang)}</button>
                    <button className="btn muted" onClick={() => void decideApproval(a, false)}>{t("reject", lang)}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h3>{t("inspectorTitle", lang)}</h3>
          <div className="kv">
            <span className="k">{t("significance", lang)}</span><span>{inspector.significance !== undefined ? `${Math.round(inspector.significance * 100)}%` : "—"}</span>
            <span className="k">{t("deliberated", lang)}</span><span>{inspector.deliberated ? t("yes", lang) : t("no", lang)}</span>
            <span className="k">{t("provider", lang)}</span><span>{inspector.provider ?? "—"}{inspector.usedFallback ? " (fallback)" : ""}</span>
            <span className="k">{t("confidence", lang)}</span><span>{inspector.confidence !== undefined ? `${Math.round(inspector.confidence * 100)}%` : "—"}</span>
            <span className="k">{t("morph", lang)}</span><span>{inspector.morphApplied ? t("applied", lang) : t("none", lang)}</span>
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
          <h3>{t("logTitle", lang)}</h3>
          <div className="stack" style={{ gap: 4 }}>
            {log.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>{t("noEvents", lang)}</span> : null}
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
