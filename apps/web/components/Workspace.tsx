"use client";

/**
 * The body: one core, one loop, and the surfaces that show what it did.
 *
 * What is left here is the loop itself — an event in, a result applied, a morph undone — and the
 * wiring that hands the result to the pieces that draw it. The boundaries around it have their
 * own files under `workspace/`: which session this is and what it persists, the connected
 * runtime, the restore, this page's own senses, the settings, and each surface the rail shows.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequest, AttentionState, AutonomyLevel, MatterEvent, UIAction, UIBlueprint } from "@particle/contracts";
import { createRuntimeCore, replay, type IngestResult, type RuntimeCore } from "@particle/runtime-core";
import { Render, RendererProvider, text as displayText } from "./Renderer";
import { type DebugState } from "./DeveloperInspector";
import { buildSimEvent as buildEvent, type SimSpec } from "@particle/contracts";
import { mergeSuggestions, type Suggestion } from "../lib/suggestions";
import { t, tr, fillTemplate } from "../lib/i18n";
import {
  EVENTS_KEY,
  PREFS_KEY,
  SESSION,
  nowIso,
  nowMs,
  waitForRestore,
  whyNot,
  type HeldMorph,
  type Inspector,
  type LogEntry,
  type Learned,
  type MorphStep,
  type Presence,
} from "./workspace/session";
import { useRuntimeConnection } from "./workspace/useRuntimeConnection";
import { useSessionRestore } from "./workspace/useSessionRestore";
import { useBehaviorSensors } from "./workspace/useBehaviorSensors";
import { useWorkspaceSettings } from "./workspace/useWorkspaceSettings";
import { PresencePanel } from "./workspace/PresencePanel";
import { HistoryStrip } from "./workspace/HistoryStrip";
import { HeldNotice } from "./workspace/HeldNotice";
import { DevPanel, type ReplayResult } from "./workspace/DevPanel";
import { ControlRail } from "./workspace/ControlRail";
import { NoticeRail } from "./workspace/NoticeRail";
import { InspectorRail } from "./workspace/InspectorRail";
import { ActivityLog } from "./workspace/ActivityLog";

export function Workspace() {
  // Lazy, once-only construction — useRef's initializer must not re-run the factory each render.
  const core = useRef<RuntimeCore>(undefined as unknown as RuntimeCore);
  if (!core.current) core.current = createRuntimeCore({ iso: nowIso, ms: nowMs });
  const [blueprint, setBlueprint] = useState<UIBlueprint>(() => core.current.getBlueprint(SESSION));
  const [attention, setAttention] = useState<AttentionState>({ typing: false });
  const [presence, setPresence] = useState<Presence>("observing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inspector, setInspector] = useState<Inspector>({ capabilities: [], guardReasonCodes: [], dropped: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const { theme, setTheme, lang, setLang, showCoach, setShowCoach, showPresence, setShowPresence, devMode, setDevMode, applyTheme, dismissCoach, dismissCoachRef } =
    useWorkspaceSettings();
  const [debug, setDebug] = useState<DebugState>({ traces: [], audit: [] });
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [patternSugs, setPatternSugs] = useState<Suggestion[]>([]);
  const [learned, setLearned] = useState<Learned | null>(null);
  const [restored, setRestored] = useState(false);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importedPrefs = useRef<{ preferences?: { key: string; weight: number }[]; patterns?: { key: string; count: number; firstSeen: string; lastSeen: string; suggested: boolean }[] } | null>(null);
  const [events, setEvents] = useState<MatterEvent[]>([]);
  const [morphs, setMorphs] = useState<MorphStep[]>([]);
  const [held, setHeld] = useState<HeldMorph | null>(null);
  const heldRef = useRef<typeof held>(null);
  heldRef.current = held; // read by clearFocus without re-creating the renderer context
  const [replayResult, setReplayResult] = useState<ReplayResult>(null);
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(2);
  const counter = useRef(0);

  const addApprovals = useCallback((incoming: ApprovalRequest[]) => {
    if (!incoming?.length) return;
    setApprovals((a) => {
      const ids = new Set(a.map((x) => x.id));
      return [...a, ...incoming.filter((x) => !ids.has(x.id))];
    });
  }, []);

  /**
   * A line in the activity log.
   *
   * The log is the third surface that shows values from outside — the renderer and the inspector
   * are the other two, and both read through the same helper. This one rendered whatever it was
   * handed, and it is handed names a model wrote: the capability an action names, the reason codes
   * a morph was held for, the id of a patch.
   */
  const pushLog = useCallback((text: string, kind: LogEntry["kind"]) => {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text: displayText(text), kind }, ...l].slice(0, 40));
  }, []);

  const applyResult = useCallback(
    (res: IngestResult) => {
      setBlueprint(res.blueprint);
      setPresence(res.presence as Presence);
      setCanUndo(core.current.canUndo(SESSION));
      setCanRedo(core.current.canRedo(SESSION));
      if (res.morph.applied) {
        setMorphs((m) => [...m, { id: res.morph.patch?.patchId ?? `m${m.length + 1}`, intent: res.decision?.uiPlan?.intent ?? "morph", at: new Date().toLocaleTimeString() }]);
      }
      addApprovals(res.pendingApprovals);
      if (res.patternSuggestions.length) {
        setPatternSugs((p) => mergeSuggestions(p, res.patternSuggestions));
        // a suggestion is offered ONCE, ever — persist the suggested flag so a reload can't re-offer
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(core.current.exportMemory(SESSION))); } catch {}
      }
      if (res.learned) setLearned(res.learned);
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

  const { mode, connected, client, otherSessions, toggleMode } = useRuntimeConnection({
    core,
    pushLog,
    addApprovals,
    setApprovals,
    setBlueprint,
    setCanUndo,
    setPresence,
    setDebug,
    setPatternSugs,
    setLearned,
  });

  const ingest = useCallback(
    async (event: MatterEvent) => {
      await waitForRestore();
      const quiet = event.severity === "debug"; // behavior sensing — shape only, no log spam
      if (!quiet) pushLog(`${event.type} · ${event.severity}`, "event");
      setPresence("evaluating");
      setEvents((e) => {
        const next = [...e, event];
        try { localStorage.setItem(EVENTS_KEY, JSON.stringify(next.slice(-500))); } catch {} // bounded log
        return next;
      });
      const res = await core.current.ingest(event, attention);
      applyResult(res);
      if (!res.deliberated) { if (!quiet) pushLog(`no morph — ${event.type} not significant`, "note"); }
      else if (res.morph.applied) pushLog(`UI morphed → ${res.morph.patch?.patchId ?? "patch"} (${res.capabilityRuns.length} capabilities ran)`, "morph");
      else pushLog(`morph blocked — ${res.morph.guardReasonCodes.join(", ") || "no change"}`, "blocked");
      if (res.deliberated && !res.morph.applied && res.morph.guardReasonCodes.length) setHeld({ codes: res.morph.guardReasonCodes, at: Date.now(), retryMs: res.retryAfterMs });
      if (res.morph.applied) setHeld(null);
      // a timing hold is temporary: schedule one reconcile tick so the body catches up (an event,
      // so replay sees it). The pending tick SURVIVES unrelated events — cleared only when the
      // body actually caught up (morph applied) or a new hold re-arms it.
      if (res.morph.applied && reconcileTimer.current) {
        clearTimeout(reconcileTimer.current);
        reconcileTimer.current = null;
      }
      if (res.retryAfterMs !== undefined) {
        if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
        reconcileTimer.current = setTimeout(() => {
          reconcileTimer.current = null;
          void ingestRef.current({ id: `reconcile${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "system", type: "runtime.reconcile", severity: "debug", payload: { reason: "guard_hold_expired" } });
        }, Math.min(res.retryAfterMs, 60_000));
      }
      if (res.presence === "acting") setTimeout(() => setPresence("observing"), 600);
    },
    [attention, applyResult, pushLog],
  );

  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const emitSim = (spec: SimSpec) => {
    if (mode === "connected" && client.current) {
      pushLog(`${spec.type} · ${spec.severity} → server`, "event");
      setPresence("evaluating");
      const c = client.current;
      // a click is behavior in EVERY mode: the semantic action key goes first (repeats → "stuck").
      // If the behavior key fails on a blip, the sim event must STILL fire (behavior lost > sim lost).
      void c
        .emit({ id: `u${++counter.current}-${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "user", type: "user.action", severity: "debug", payload: { key: spec.key } })
        .catch(() => null)
        .then((r) => {
          if (r?.learned) setLearned(r.learned);
          return c.emitSim(spec.key);
        })
        .then((resp) => {
        if (resp?.pendingApprovals) addApprovals(resp.pendingApprovals);
        if (resp?.deliberated && resp.morph && !resp.morph.applied && resp.morph.guardReasonCodes.length) {
          setHeld({ codes: resp.morph.guardReasonCodes, at: Date.now(), retryMs: resp.retryAfterMs });
        }
        if (resp?.morph?.applied) setHeld(null);
        if (resp?.patternSuggestions?.length) {
          setPatternSugs((p) => mergeSuggestions(p, resp.patternSuggestions!));
        }
        if (resp?.learned) setLearned(resp.learned);
      })
        .catch((err) => {
          pushLog(`event not sent — ${whyNot(err)}`, "blocked");
          setPresence("observing");
        });
      return;
    }
    // Concept v2: a click is behavior. Emit the semantic action first (repeats → "stuck"),
    // then the simulated system event itself.
    void ingest({ id: `u${++counter.current}`, sessionId: SESSION, timestamp: nowIso(), source: "user", type: "user.action", severity: "debug", payload: { key: spec.key } })
      .then(() => ingest(buildEvent(spec, SESSION, `e${++counter.current}`, nowIso())));
  };

  const decideApproval = useCallback(
    async (approval: ApprovalRequest, accept: boolean) => {
      if (mode === "connected" && client.current) {
        try {
          await (accept ? client.current.approve(approval.id) : client.current.reject(approval.id));
        } catch (err) {
          // This is the consent surface. The answer used to be thrown away and the card dropped
          // either way, so a 401 or a 404 looked exactly like a decision the runtime had taken —
          // and the person was left believing an outward-facing capability had run.
          pushLog(`${accept ? "approve" : "reject"} not taken — ${whyNot(err)}`, "blocked");
          return; // the question is still open: the card stays
        }
      } else if (accept) {
        const outcome = await core.current.approve(approval.id);
        pushLog(`approved ${approval.capabilityId} → ${outcome?.result.ok ? "executed" : "failed"}`, outcome?.result.ok ? "morph" : "blocked");
      } else {
        core.current.reject(approval.id);
        pushLog(`rejected ${approval.capabilityId}`, "note");
      }
      setApprovals((a) => a.filter((x) => x.id !== approval.id));
    },
    [mode, client, pushLog],
  );

  /**
   * What a press of Approve or Reject does. The buttons called the async function and dropped the
   * promise, so a rejection with nothing attached was an unhandled one: in a disconnected tab the
   * press did nothing at all and said nothing at all.
   */
  const onDecide = useCallback(
    (approval: ApprovalRequest, accept: boolean) => {
      void decideApproval(approval, accept).catch((err) => pushLog(`${accept ? "approve" : "reject"} not taken — ${whyNot(err)}`, "blocked"));
    },
    [decideApproval, pushLog],
  );

  const undo = useCallback((componentId?: string) => {
    if (mode === "connected" && client.current) {
      // attribution travels with the gesture; the log waits for the server to agree it happened
      void client.current
        .undo({ componentId })
        .then(() => pushLog("undo → server", "undo"))
        .catch((err) => pushLog(`undo not taken — ${whyNot(err)}`, "blocked"));
      return;
    }
    const before = core.current.historyDepth(SESSION);
    const bp = core.current.undo(SESSION, { componentId });
    if (!bp) return;
    // what was just learned outlives this tab (P4): preferences only — never events or content
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(core.current.exportMemory(SESSION))); } catch {}
    setBlueprint(bp);
    setCanUndo(core.current.canUndo(SESSION));
    setCanRedo(core.current.canRedo(SESSION));
    // a targeted dismissal PUSHES a history entry (the strip must grow), a plain undo pops it
    const after = core.current.historyDepth(SESSION);
    setMorphs((m) =>
      after < before ? m.slice(0, -1) : [...m, { id: `dismiss${Date.now()}`, intent: "dismiss", at: new Date().toLocaleTimeString() }],
    );
    pushLog(after < before ? "undo — reverted last morph" : "dismissed the card (undoable)", "undo");
  }, [mode, client, pushLog]);

  const redo = useCallback(() => {
    if (mode === "connected" && client.current) {
      void client.current
        .redo()
        .then((ok) => pushLog(ok ? "redo → server" : "nothing to redo (server)", ok ? "morph" : "note"))
        .catch((err) => pushLog(`redo not sent — ${whyNot(err)}`, "blocked"));
      return;
    }
    const redoMeta = core.current.peekRedo(SESSION);
    const bp = core.current.redo(SESSION);
    if (!bp) return;
    // a redo hands a learned dismissal back — persist the corrected memory too
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(core.current.exportMemory(SESSION))); } catch {}
    setBlueprint(bp);
    setCanUndo(core.current.canUndo(SESSION));
    setCanRedo(core.current.canRedo(SESSION));
    setMorphs((m) => [...m, { id: `redo${Date.now()}`, intent: redoMeta?.intent ?? "morph", at: new Date().toLocaleTimeString() }]);
    pushLog("redo — reapplied the undone morph", "morph");
  }, [mode, client, pushLog]);

  // Multi-step undo: revert every morph from the end back to (and including) index `i`.
  const undoTo = useCallback((i: number) => {
    if (mode === "connected") return;
    let bp: UIBlueprint | null = null;
    let steps = 0;
    for (let k = morphs.length - 1; k >= i; k--) {
      const next = core.current.undo(SESSION, { learn: false }); // a "go back" gesture is not a dismissal
      if (!next) break;
      setCanRedo(core.current.canRedo(SESSION));
      bp = next; steps++;
    }
    if (bp) setBlueprint(bp);
    setCanUndo(core.current.canUndo(SESSION));
    setMorphs((m) => m.slice(0, i));
    pushLog(`undo ×${steps} — reverted to before step ${i + 1}`, "undo");
  }, [mode, morphs.length, pushLog]);

  const rendererCtx = useMemo(
    () => ({
      emitAction: (action: UIAction) => {
        if (action.event === "user.requested_undo") return undo(typeof action.payload?.targetId === "string" ? action.payload.targetId : undefined);
        pushLog(`action — ${action.capabilityId ?? action.event}`, "note");
      },
      setFocus: (id: string) => setAttention({ typing: true, focusedComponentId: id, lastInteractionAt: nowIso() }),
      clearFocus: () => {
        setAttention({ typing: false });
        // an attention-held morph gets its second chance when focus is released (timing holds
        // already have a timer; focus/unsaved holds end exactly here)
        if (heldRef.current && !reconcileTimer.current && modeRef.current === "local") {
          reconcileTimer.current = setTimeout(() => {
            reconcileTimer.current = null;
            void ingestRef.current({ id: `reconcile${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "system", type: "runtime.reconcile", severity: "debug", payload: { reason: "focus_released" } });
          }, 400);
        }
      },
      tr: (s: string) => tr(s, lang),
      tpl: (id: string, params: Record<string, unknown>) => fillTemplate(t(id, lang), params),
    }),
    [undo, pushLog, lang],
  );

  // Spec §21: replay the session's event log through a fresh core and check determinism.
  const replayVerify = useCallback(async () => {
    if (events.length === 0) return setReplayResult("none");
    // event-sourced clock + the preferences that were in force when this session was restored
    const { core: fresh } = await replay(events, undefined, { memory: importedPrefs.current });
    const same = JSON.stringify(fresh.getBlueprint(SESSION).root) === JSON.stringify(core.current.getBlueprint(SESSION).root);
    setReplayResult(same ? "identical" : "differs");
    pushLog(same ? "replay ✓ deterministic" : "replay differs (undo/approval not events)", same ? "morph" : "note");
  }, [events, pushLog]);

  const onAutonomyChange = (n: AutonomyLevel) => {
    setAutonomy(n);
    core.current.setAutonomyLevel(n);
    if (mode === "connected" && client.current) {
      void client.current.setAutonomy(n).catch((err) => pushLog(`autonomy not taken by the runtime — ${whyNot(err)}`, "blocked"));
    }
    pushLog(`autonomy level → L${n}${mode === "connected" ? " (server)" : ""}`, "note");
  };

  // Tear down the WebSocket if the component unmounts while connected (no leaked socket/state).
  useEffect(() => () => {
    client.current?.disconnect();
    client.current = null;
    if (reconcileTimer.current) {
      clearTimeout(reconcileTimer.current); // never ingest into an unmounted body
      reconcileTimer.current = null;
    }
  }, []);

  useSessionRestore({
    core,
    applyResult,
    pushLog,
    lang,
    setLang,
    setTheme,
    setShowCoach,
    setMorphs,
    setEvents,
    setRestored,
    counter,
    importedPrefs,
    reconcileTimer,
    ingestRef,
  });

  // After the restore, never before it: the restore reads dm_lang, and this writes it.
  useEffect(() => {
    try { localStorage.setItem("dm_lang", lang); } catch {}
  }, [lang]);

  useBehaviorSensors(ingestRef, modeRef);

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
    <div className="app" data-restored={restored ? "1" : "0"}>
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
            <PresencePanel
              lang={lang}
              presence={presence}
              showPresence={showPresence}
              setShowPresence={setShowPresence}
              autonomy={autonomy}
              debug={debug}
              reasonSummary={inspector.reasonSummary}
              approvals={approvals}
            />
          </div>
        </div>
        {showCoach ? (
          <div className="coach">
            <span>{t("coachText", lang)}</span>
            <button className="btn" onClick={dismissCoach}>{t("coachDismiss", lang)}</button>
          </div>
        ) : null}
        {mode === "local" ? <HistoryStrip lang={lang} morphs={morphs} onUndoTo={undoTo} /> : null}
        {held ? <HeldNotice lang={lang} held={held} onDismiss={() => setHeld(null)} /> : null}
        <div style={{ paddingTop: 16 }}>
          <RendererProvider value={rendererCtx}>
            <Render node={blueprint.root} />
          </RendererProvider>
        </div>
        {devMode ? (
          <DevPanel lang={lang} debug={debug} replayResult={replayResult} onReplayVerify={() => void replayVerify()} />
        ) : null}
      </main>

      <aside className="rail">
        <ControlRail
          lang={lang}
          onSim={emitSim}
          canUndo={canUndo}
          canRedo={canRedo}
          mode={mode}
          connected={connected}
          theme={theme}
          applyTheme={applyTheme}
          devMode={devMode}
          setDevMode={setDevMode}
          onUndo={() => undo()}
          onRedo={redo}
          onToggleMode={() => void toggleMode()}
          otherSessions={otherSessions}
          blueprintMode={blueprint.mode}
          attention={attention}
          debug={debug}
          autonomy={autonomy}
          onAutonomyChange={onAutonomyChange}
        />

        <NoticeRail
          lang={lang}
          patternSugs={patternSugs}
          setPatternSugs={setPatternSugs}
          learned={learned}
          setLearned={setLearned}
          approvals={approvals}
          onDecide={onDecide}
        />

        <InspectorRail lang={lang} inspector={inspector} />

        <ActivityLog lang={lang} log={log} />
      </aside>
    </div>
  );
}
