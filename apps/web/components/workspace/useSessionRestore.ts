"use client";

/**
 * Bringing a session back: the preferences the person set, then the event log itself.
 *
 * Event sourcing in the browser — the workspace survives a refresh because the saved events are
 * replayed through the same core, not because a blueprint was written down. Preferences are
 * imported first, so the replayed log is judged the way the person taught us, and live events
 * wait behind the restore gate until the whole log has been through.
 *
 * All of it is one mount effect on purpose: a throw anywhere in it has to end with the gate open
 * and the body usable, which is what the single catch around it is for.
 */
import React, { useEffect } from "react";
import type { MatterEvent } from "@particle/contracts";
import { MatterEvent as MatterEventSchema } from "@particle/contracts";
import type { IngestResult, RuntimeCore } from "@particle/runtime-core";
import { t, type Lang } from "../../lib/i18n";
import {
  AUTO_CONNECT,
  EVENTS_KEY,
  PREFS_KEY,
  SESSION,
  nowIso,
  holdLiveEvents,
  releaseRestore,
  replayClock,
  restoredCores,
  type LogEntry,
  type MorphStep,
} from "./session";

/** What a restore is allowed to put back, and the memory the replay must be judged against. */
export type RestoreBody = {
  core: React.RefObject<RuntimeCore>;
  applyResult: (res: IngestResult) => void;
  pushLog: (text: string, kind: LogEntry["kind"]) => void;
  lang: Lang;
  setLang: React.Dispatch<React.SetStateAction<Lang>>;
  setTheme: React.Dispatch<React.SetStateAction<"system" | "dark" | "light">>;
  setShowCoach: React.Dispatch<React.SetStateAction<boolean>>;
  setMorphs: React.Dispatch<React.SetStateAction<MorphStep[]>>;
  setEvents: React.Dispatch<React.SetStateAction<MatterEvent[]>>;
  setRestored: React.Dispatch<React.SetStateAction<boolean>>;
  counter: React.RefObject<number>;
  importedPrefs: React.RefObject<{ preferences?: { key: string; weight: number }[]; patterns?: { key: string; count: number; firstSeen: string; lastSeen: string; suggested: boolean }[] } | null>;
  reconcileTimer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  ingestRef: React.RefObject<(event: MatterEvent) => Promise<void>>;
};

export function useSessionRestore(body: RestoreBody): void {
  const { core, applyResult, pushLog, lang, setLang, setTheme, setShowCoach, setMorphs, setEvents, setRestored, counter, importedPrefs, reconcileTimer, ingestRef } = body;

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
      holdLiveEvents();
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
}
