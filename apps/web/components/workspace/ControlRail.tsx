"use client";

/**
 * The controls: what you can make happen to this body, and which runtime is driving it.
 *
 * The simulation lab fires the events a real sensor would; the rest is the few things a person is
 * allowed to decide for themselves — undo, theme, the developer surface, which runtime is in
 * charge, and how far the AI may go without asking.
 */
import React from "react";
import type { AttentionState, AutonomyLevel, SessionSummary } from "@particle/contracts";
import { SIM_EVENTS, type SimSpec } from "@particle/contracts";
import { describeAutonomy } from "../../lib/risk";
import { describeIntent } from "../../lib/intent";
import { describeLayer } from "../../lib/sensing";
import { sessionHref } from "../../lib/runtimeClient";
import { t, tr, type Lang } from "../../lib/i18n";
import type { DebugState } from "../DeveloperInspector";
import { EVENTS_KEY, PREFS_KEY, SESSION } from "./session";

export function ControlRail({
  lang,
  onSim,
  canUndo,
  canRedo,
  mode,
  connected,
  theme,
  applyTheme,
  devMode,
  setDevMode,
  onUndo,
  onRedo,
  onToggleMode,
  otherSessions,
  blueprintMode,
  attention,
  debug,
  autonomy,
  onAutonomyChange,
}: {
  lang: Lang;
  onSim: (spec: SimSpec) => void;
  canUndo: boolean;
  canRedo: boolean;
  mode: "local" | "connected";
  connected: boolean;
  theme: "system" | "dark" | "light";
  applyTheme: (t: "system" | "dark" | "light") => void;
  devMode: boolean;
  setDevMode: React.Dispatch<React.SetStateAction<boolean>>;
  onUndo: () => void;
  onRedo: () => void;
  onToggleMode: () => void;
  otherSessions: SessionSummary[];
  blueprintMode: string;
  attention: AttentionState;
  debug: DebugState;
  autonomy: AutonomyLevel;
  onAutonomyChange: (n: AutonomyLevel) => void;
}) {
  return (
    <>
      <section>
        <h3>{t("simLab", lang)}</h3>
        <div className="simrow">
          {SIM_EVENTS.map((s) => (
            <button key={s.label} className="btn" onClick={() => onSim(s)}>{tr(s.label, lang)}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("simIntro", lang)}</p>
      </section>

      <section>
        <h3>{t("controls", lang)}</h3>
        <div className="simrow">
          <button className="btn" onClick={onUndo} disabled={!canUndo}>{t("undo", lang)}</button>
          <button className="btn" onClick={onRedo} disabled={mode === "local" && !canRedo}>{t("redo", lang)}</button>
          <button className="btn muted" onClick={() => { try { localStorage.removeItem(EVENTS_KEY); localStorage.removeItem(PREFS_KEY); } catch {} window.location.reload(); }}>{t("resetSession", lang)}</button>
          <button className="btn muted" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>{t("theme", lang)}: {theme}</button>
          <button className={`btn${devMode ? " primary" : " muted"}`} onClick={() => setDevMode((v) => !v)}>{t("devMode", lang)}</button>
          <button className={`btn${mode === "connected" ? " primary" : ""}`} onClick={onToggleMode}>
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
                    <a href={sessionHref(s.sessionId)} style={{ fontFamily: "var(--mono)" }}>
                      {s.sessionId}
                    </a>
                  )}
                  <span className="muted">
                    {" · "}
                    {describeIntent(s.intent, lang) || "—"}
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
          <span className="k">{t("mode", lang)}</span><span>{tr(blueprintMode, lang)}</span>
          <span className="k">{t("focus", lang)}</span><span>{attention.focusedComponentId ?? "—"}{attention.typing ? ` (${t("typing", lang)})` : ""}</span>
          <span className="k">{t("intentTitle", lang)}</span>
          <span>{debug.worldState?.inferredIntent ? `${describeIntent(debug.worldState.inferredIntent.label, lang)} · ${Math.round(debug.worldState.inferredIntent.confidence * 100)}%` : "—"}</span>
          <span className="k">{t("autonomy", lang)}</span>
          <span>
            <select
            aria-label={t("presenceAutonomy", lang)}
              className="select"
              style={{ width: "auto", padding: "4px 8px" }}
              value={autonomy}
              onChange={(e) => onAutonomyChange(Number(e.target.value) as AutonomyLevel)}
            >
              <option value={0}>L0 · {t("autonomy_0", lang)}</option>
              <option value={1}>L1 · {t("autonomy_1", lang)}</option>
              <option value={2}>L2 · {t("autonomy_2", lang)}</option>
              <option value={3}>L3 · {t("autonomy_3", lang)}</option>
              <option value={4}>L4 · {t("autonomy_4", lang)}</option>
            </select>
          </span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          L{autonomy} {describeAutonomy(autonomy, lang)}. {t("autonomyHint", lang)}
        </p>
      </section>
    </>
  );
}
