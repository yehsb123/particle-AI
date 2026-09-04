"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReplayClock } from "../lib/replayClock";
import { describeHold } from "../lib/hold";
import { describeMorphStep } from "../lib/morphStep";
import { describeSensor, describeLayer } from "../lib/sensing";
import { describeApprovalReason, missingPermissionNames } from "../lib/approval";
import type { ApprovalRequest, AttentionState, AutonomyLevel, MatterEvent, UIAction, UIBlueprint } from "@particle/contracts";
import { MatterEvent as MatterEventSchema } from "@particle/contracts";
import { createRuntimeCore, replay, type IngestResult, type RuntimeCore } from "@particle/runtime-core";
import { Render, RendererProvider } from "./Renderer";
import { DeveloperInspector, type DebugState } from "./DeveloperInspector";
import { SIM_EVENTS, buildEvent, type SimSpec } from "../lib/sim";
import { RuntimeClient, type ServerMessage } from "../lib/runtimeClient";
import { t, tr, fillTemplate, type Lang } from "../lib/i18n";

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

const SESSION =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("session") ?? "session-local" : "session-local";
const AUTO_CONNECT = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("connect") === "1";
// While restoring a saved log, "now" is the replayed event's own timestamp, and it only ever
// moves forward (see lib/replayClock).
const replayClock = createReplayClock();
const nowIso = () => replayClock.iso();
const nowMs = () => replayClock.ms();
// Storage is per session: the main tab and the extension side panel share an origin but not a log.
const EVENTS_KEY = `dm_events:${SESSION}`;
const PREFS_KEY = `dm_prefs:${SESSION}`;
// Live events wait until the saved log has been replayed, so nothing is stamped with a replayed
// timestamp or written over the log mid-restore. Resolved immediately when there is nothing to restore.
let releaseRestore: () => void = () => {};
let restoreGate: Promise<void> = Promise.resolve(); // re-created per restore (see below)
const restoredCores = new WeakSet<object>(); // StrictMode double-mounts share a core — replay once; a real remount gets a new core and restores again

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
  const [learned, setLearned] = useState<{ suppressed: string; dismissals: number } | null>(null);
  const [otherSessions, setOtherSessions] = useState<{ sessionId: string; intent?: string; problems: number; layers: string[] }[]>([]);
  const [restored, setRestored] = useState(false);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importedPrefs = useRef<{ preferences?: { key: string; weight: number }[]; patterns?: { key: string; count: number; firstSeen: string; lastSeen: string; suggested: boolean }[] } | null>(null);
  // Honest indicator: this page's own in-app sensors + whatever other sensors REPORTED to this
  // session (extension / agent announce their consented layers via sensor.layers_changed).
  const sensingLine = useMemo(() => {
    const reported = Object.entries(debug.worldState?.sensing ?? {}) as [string, string[]][];
    if (!reported.length) return t("sensingNone", lang);
    return reported.map(([s, ls]) => `${describeSensor(s, lang)}: ${ls.map((l) => describeLayer(l, lang)).join(", ")}`).join(" · ");
  }, [debug.worldState, lang]);
  const [events, setEvents] = useState<MatterEvent[]>([]);
  const [morphs, setMorphs] = useState<{ id: string; intent: string; at: string }[]>([]);
  const [held, setHeld] = useState<{ codes: string[]; at: number; retryMs?: number } | null>(null);
  const heldRef = useRef<typeof held>(null);
  heldRef.current = held; // read by clearFocus without re-creating the renderer context
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
      setCanRedo(core.current.canRedo(SESSION));
      if (res.morph.applied) {
        setMorphs((m) => [...m, { id: res.morph.patch?.patchId ?? `m${m.length + 1}`, intent: res.decision?.uiPlan?.intent ?? "morph", at: new Date().toLocaleTimeString() }]);
      }
      addApprovals(res.pendingApprovals);
      if (res.patternSuggestions.length) {
        setPatternSugs((p) => [
          ...p,
          ...res.patternSuggestions
            .filter((s) => !p.some((x) => x.key === s.key))
            .map((s) => ({ key: s.key, count: s.count })),
        ]);
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

  const ingest = useCallback(
    async (event: MatterEvent) => {
      await restoreGate;
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
          setPatternSugs((p) => [...p, ...resp.patternSuggestions!.filter((x) => !p.some((y) => y.key === x.key))]);
        }
        if (resp?.learned) setLearned(resp.learned);
      })
        .catch(() => {
          pushLog("server unreachable — event not sent", "blocked");
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

  const undo = useCallback((componentId?: string) => {
    if (mode === "connected" && client.current) {
      void client.current.undo({ componentId }); // attribution travels with the gesture
      pushLog("undo → server", "undo");
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
  }, [mode, pushLog]);

  const redo = useCallback(() => {
    if (mode === "connected" && client.current) {
      void client.current
        .redo()
        .then((ok) => pushLog(ok ? "redo → server" : "nothing to redo (server)", ok ? "morph" : "note"))
        .catch(() => pushLog("server unreachable — redo not sent", "blocked"));
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
  }, [mode, pushLog]);

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
      } else if (m.kind === "pattern_suggestions") {
        setPatternSugs((p) => [...p, ...m.suggestions.filter((x) => !p.some((y) => y.key === x.key))]);
      } else if (m.kind === "learned") {
        setLearned(m.learned);
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

  // Multi-session view: while connected, poll the runtime's shape-level session summaries.
  useEffect(() => {
    if (mode !== "connected") {
      setOtherSessions([]);
      return;
    }
    let alive = true;
    const tick = () => {
      void client.current?.sessions().then((list) => {
        if (alive) setOtherSessions(list);
      }).catch(() => undefined);
    };
    tick();
    const t = setInterval(tick, 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mode]);

  // Embedded body (extension side panel opens /?connect=1&session=ext): connect to the runtime once.
  const toggleModeRef = useRef(toggleMode);
  toggleModeRef.current = toggleMode;
  useEffect(() => {
    if (AUTO_CONNECT) void toggleModeRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (reconcileTimer.current) {
      clearTimeout(reconcileTimer.current); // never ingest into an unmounted body
      reconcileTimer.current = null;
    }
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
      if (restoredCores.has(core.current)) return; // StrictMode remount: the first run owns the gate
      restoredCores.add(core.current);
      if (AUTO_CONNECT) {
        // embedded/connected body: the server owns the state — nothing local to replay
        setRestored(true);
        return;
      }
      restoreGate = new Promise((r) => { releaseRestore = r; });
      // learned preferences first, so the replayed log is judged the way the person taught us
      try {
        const prefs = localStorage.getItem(PREFS_KEY);
        if (prefs) {
          // preferences come back whole. Patterns come back as suggested MARKS only (count 1):
          // the event-log replay below re-observes the real counts, and importing those too would
          // double-count — but the sticky `suggested` flag must survive so a reload never
          // re-offers a template the person already saw.
          const stored = JSON.parse(prefs) as { preferences?: { key: string; weight: number }[]; patterns?: { key: string; suggested?: boolean }[] };
          const parsedPrefs = {
            // dismissed:* only — replay re-reinforces morph:* counters, importing them too would
            // compound the weights on every reload
            preferences: (stored.preferences ?? []).filter((pr) => typeof pr.key === "string" && pr.key.startsWith("dismissed:")),
            patterns: (stored.patterns ?? [])
              .filter((pt) => pt.suggested === true && typeof pt.key === "string")
              .map((pt) => ({ key: pt.key, count: 1, firstSeen: "", lastSeen: "", suggested: true })),
          };
          importedPrefs.current = parsedPrefs;
          core.current.importMemory(SESSION, parsedPrefs);
        }
      } catch {}
      const raw = localStorage.getItem(EVENTS_KEY);
      if (!raw) {
        releaseRestore();
        setRestored(true);
      }
      if (raw) {
        const parsed = (JSON.parse(raw) as unknown[])
          .map((x) => MatterEventSchema.safeParse(x))
          .filter((r) => r.success)
          .map((r) => r.data)
          .filter((ev) => ev.sessionId === SESSION); // never replay another session's log
        if (!parsed.length) {
          releaseRestore();
          setRestored(true);
        }
        if (parsed.length) {
          void (async () => {
            const results: IngestResult[] = [];
            try {
              for (const ev of parsed) {
                replayClock.advanceTo(ev.timestamp);
                results.push(await core.current.ingest(ev));
              }
            } finally {
              replayClock.release();
            }
            const last = results.at(-1);
            if (last) applyResult(last);
            // a log can END on a timing hold (held morph, then silence). applyResult only saw the
            // last result — walk the whole replay: if a hold was never followed by an applied
            // morph, arm one reconcile tick now so the restored body catches up on its own.
            let pendingRetry: number | undefined;
            for (const r of results) {
              if (r.morph.applied) pendingRetry = undefined;
              else if (r.retryAfterMs !== undefined) pendingRetry = r.retryAfterMs;
            }
            if (pendingRetry !== undefined && !reconcileTimer.current) {
              reconcileTimer.current = setTimeout(() => {
                reconcileTimer.current = null;
                void ingestRef.current({ id: `reconcile${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "system", type: "runtime.reconcile", severity: "debug", payload: { reason: "restored_with_pending_hold" } });
              }, Math.min(pendingRetry, 60_000));
            }
            // the history strip must match the undo stack that replay just rebuilt
            setMorphs(
              results
                .filter((r) => r.morph.applied)
                .map((r, i) => ({ id: r.morph.patch?.patchId ?? `m${i + 1}`, intent: r.decision?.uiPlan?.intent ?? "morph", at: new Date(r.worldState.updatedAt).toLocaleTimeString() })),
            );
            setEvents(parsed);
            counter.current = parsed.length;
            pushLog(t("restoredNote", lang), "note");
          })()
            .catch(() => pushLog("restore failed — starting fresh (the log may predate this build)", "blocked"))
            .finally(() => {
              // the gate MUST open even if an old log fails to replay — otherwise every live
              // event (sensors, clicks, reconcile ticks) would hang forever
              releaseRestore();
              setRestored(true);
            });
        }
      }
    } catch {
      setShowCoach(true);
      releaseRestore();
      setRestored(true);
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("dm_lang", lang); } catch {}
  }, [lang]);

  // Sensors (Concept v2, L0/L3): tab visibility → "returning"; no interaction → "idle".
  // Shape only: we never read what was typed or clicked, just that interaction happened.
  useEffect(() => {
    let hiddenAt: number | null = null;
    let lastInteraction = Date.now();
    let idleReported = false;
    let interactions = 0;
    // announce exactly what this page observes — the indicator is derived from these reports only
    if (modeRef.current === "local") {
      void ingestRef.current({ id: `sense${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "sensor", type: "sensor.layers_changed", severity: "debug", payload: { sensor: "web", layers: ["interactions", "idle", "visibility"] } });
    }
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
      hiddenAt = null;
      if (modeRef.current === "local" && away >= 5) {
        void ingestRef.current({ id: `vis${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "user", type: "user.visibility", severity: "info", payload: { visible: true, awaySeconds: away } });
      }
    };
    const onInteract = () => { lastInteraction = Date.now(); idleReported = false; interactions += 1; };
    // L0: THAT interaction happened (a count every 10 s) — never which key, which target, or what text
    const batchTimer = setInterval(() => {
      if (interactions > 0 && modeRef.current === "local") {
        const count = interactions;
        interactions = 0;
        void ingestRef.current({ id: `int${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "user", type: "user.interaction", severity: "debug", payload: { count } });
      }
    }, 10_000);
    const idleTimer = setInterval(() => {
      const idle = Math.round((Date.now() - lastInteraction) / 1000);
      if (idle >= 60 && !idleReported && modeRef.current === "local") {
        idleReported = true;
        void ingestRef.current({ id: `idle${Date.now()}`, sessionId: SESSION, timestamp: nowIso(), source: "user", type: "user.idle", severity: "debug", payload: { seconds: idle } });
      }
    }, 15_000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("scroll", onInteract, true);
    return () => {
      clearInterval(idleTimer);
      clearInterval(batchTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("scroll", onInteract, true);
    };
  }, []);

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
                    <span className="k">{t("intentTitle", lang)}</span>
                    <span>{debug.worldState?.inferredIntent ? t(`intent_${debug.worldState.inferredIntent.label}`, lang) : "—"}</span>
                  </div>
                  <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }} data-testid="sensing-line">
                    {t("sensingPrefix", lang)} — {sensingLine} ({t("sensingShapeOnly", lang)})
                  </p>
                  {(debug.memory?.preferences ?? []).some((p) => p.key.startsWith("dismissed:")) ? (
                    <>
                      <div className="divider" style={{ margin: "10px 0" }} />
                      <div className="k muted" style={{ fontSize: 12 }}>{t("presenceLearned", lang)}</div>
                      <p style={{ fontSize: 12.5, margin: "6px 0 0", fontFamily: "var(--mono)" }}>
                        {(debug.memory?.preferences ?? [])
                          .filter((p) => p.key.startsWith("dismissed:"))
                          .slice(0, 3)
                          .map((p) => `${t("prefDismissed", lang)}: ${p.key.replace("dismissed:", "")} ×${p.weight}`)
                          .join(" · ")}
                      </p>
                    </>
                  ) : null}
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
        {mode === "local" ? (
          <div className="history" aria-label={t("historyTitle", lang)}>
            <span className="history-title">{t("historyTitle", lang)}</span>
            {morphs.length === 0 ? (
              <span className="muted" style={{ fontSize: 12 }}>{t("historyEmpty", lang)}</span>
            ) : (
              morphs.map((m, i) => (
                <button key={`${m.id}-${i}`} className="chip" title={t("historyHint", lang)} onClick={() => undoTo(i)}>
                  <span className="n">{i + 1}</span> {describeMorphStep(m.intent, lang)} <span className="muted">{m.at}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
        {held ? (
          <div className="held" role="status">
            <span className="badge warn"><span className="dot" />{t("heldTitle", lang)}</span>
            <span>
              {describeHold(held.codes, lang)}
              {held.retryMs !== undefined ? <b> · {fillTemplate(t("heldRetry", lang), { s: Math.ceil(held.retryMs / 1000) })}</b> : null}
            </span>
            <button className="btn muted" style={{ padding: "2px 10px" }} onClick={() => setHeld(null)}>✕</button>
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
            <button className="btn" onClick={() => undo()} disabled={!canUndo}>{t("undo", lang)}</button>
            <button className="btn" onClick={redo} disabled={mode === "local" && !canRedo}>{t("redo", lang)}</button>
            <button className="btn muted" onClick={() => { try { localStorage.removeItem(EVENTS_KEY); localStorage.removeItem(PREFS_KEY); } catch {} window.location.reload(); }}>{t("resetSession", lang)}</button>
            <button className="btn muted" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>{t("theme", lang)}: {theme}</button>
            <button className={`btn${devMode ? " primary" : " muted"}`} onClick={() => setDevMode((v) => !v)}>{t("devMode", lang)}</button>
            <button className={`btn${mode === "connected" ? " primary" : ""}`} onClick={() => void toggleMode()}>
              {t("runtime", lang)}: {mode === "connected" ? `${t("runtimeServer", lang)} ${connected ? "●" : "○"}` : t("runtimeLocal", lang)}
            </button>
          </div>
          {mode === "connected" ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("connectedNote", lang)}</p>
          ) : null}
          {mode === "connected" && otherSessions.length > 0 ? (
            <div style={{ marginTop: 10 }} data-testid="sessions-view">
              <div className="k muted" style={{ fontSize: 12 }}>{t("sessionsTitle", lang)}</div>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {otherSessions.map((s) => (
                  <div key={s.sessionId} className="card" style={{ padding: "8px 10px", fontSize: 12 }}>
                    {s.sessionId === SESSION ? (
                      <span style={{ fontFamily: "var(--mono)" }}>{s.sessionId} ●</span>
                    ) : (
                      // jump to that session's body (same runtime, different senses)
                      <a href={`/?connect=1&session=${encodeURIComponent(s.sessionId)}`} style={{ fontFamily: "var(--mono)" }}>
                        {s.sessionId}
                      </a>
                    )}
                    <span className="muted">
                      {" · "}
                      {s.intent ? t(`intent_${s.intent}`, lang) : "—"}
                      {s.problems > 0 ? ` · ${s.problems} ${t("sessionsProblems", lang)}` : ""}
                    </span>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {s.layers.length ? s.layers.map((l) => describeLayer(l, lang)).join(" · ") : t("sessionsNoLayers", lang)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">{t("mode", lang)}</span><span>{tr(blueprint.mode, lang)}</span>
            <span className="k">{t("focus", lang)}</span><span>{attention.focusedComponentId ?? "—"}{attention.typing ? ` (${t("typing", lang)})` : ""}</span>
            <span className="k">{t("intentTitle", lang)}</span>
            <span>{debug.worldState?.inferredIntent ? `${t(`intent_${debug.worldState.inferredIntent.label}`, lang)} · ${Math.round(debug.worldState.inferredIntent.confidence * 100)}%` : "—"}</span>
            <span className="k">{t("autonomy", lang)}</span>
            <span>
              <select
              aria-label={t("presenceAutonomy", lang)}
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
                <option value={0}>L0 · {t("autonomy_0", lang)}</option>
                <option value={1}>L1 · {t("autonomy_1", lang)}</option>
                <option value={2}>L2 · {t("autonomy_2", lang)}</option>
                <option value={3}>L3 · {t("autonomy_3", lang)}</option>
                <option value={4}>L4 · {t("autonomy_4", lang)}</option>
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

        {learned ? (
          <section style={{ background: "var(--accent-low)" }} aria-live="polite" data-testid="learned-banner">
            <h3>{t("learnedTitle", lang)}</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
              {t("learnedText", lang)} <span style={{ fontFamily: "var(--mono)" }}>{learned.suppressed}</span> · ×{learned.dismissals}
            </p>
            <button className="btn muted" style={{ padding: "4px 12px" }} onClick={() => setLearned(null)}>
              {t("learnedOk", lang)}
            </button>
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
                  <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                    {describeApprovalReason(a, lang)}
                    {missingPermissionNames(a).map((p) => (
                      <span key={p} style={{ fontFamily: "var(--mono)", marginLeft: 6 }}>{p}</span>
                    ))}
                  </p>
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
            <span className="k">{t("provider", lang)}</span><span>{inspector.provider ?? "—"}{inspector.usedFallback ? ` (${t("fallback", lang)})` : ""}</span>
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
