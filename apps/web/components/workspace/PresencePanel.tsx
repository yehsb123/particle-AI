"use client";

/**
 * What the AI is doing, what it can sense, and what it is about to do — on one popover.
 *
 * This is the surface a person opens when they want to know whether to trust what just happened,
 * so it is also where the consent story is told: which sensors reported which layers, which of
 * them read content rather than shape, and what the screen layer would need before it ran.
 */
import React, { useMemo } from "react";
import type { ApprovalRequest, AutonomyLevel } from "@particle/contracts";
import { contentExceptions, describeLayer, describeSensor } from "../../lib/sensing";
import { describeIntent } from "../../lib/intent";
import { t, type Lang } from "../../lib/i18n";
import type { DebugState } from "../DeveloperInspector";
import type { Presence } from "./session";

export function PresencePanel({
  lang,
  presence,
  showPresence,
  setShowPresence,
  autonomy,
  debug,
  reasonSummary,
  approvals,
}: {
  lang: Lang;
  presence: Presence;
  showPresence: boolean;
  setShowPresence: React.Dispatch<React.SetStateAction<boolean>>;
  autonomy: AutonomyLevel;
  debug: DebugState;
  reasonSummary?: string;
  approvals: ApprovalRequest[];
}) {
  // Honest indicator: this page's own in-app sensors + whatever other sensors REPORTED to this
  // session (extension / agent announce their consented layers via sensor.layers_changed).
  const sensingLine = useMemo(() => {
    const reported = Object.entries(debug.worldState?.sensing ?? {}) as [string, string[]][];
    if (!reported.length) return t("sensingNone", lang);
    return reported.map(([s, ls]) => `${describeSensor(s, lang)}: ${ls.map((l) => describeLayer(l, lang)).join(", ")}`).join(" · ");
  }, [debug.worldState, lang]);
  // The caption after that line used to say "shape only" about everything in it. Two layers read
  // content — a window photographed, a page read — so the caption keeps that claim for the rest
  // and names whichever of them a sensor has actually reported (docs/CONSENT_V2.md).
  const contentExceptionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const layers of Object.values(debug.worldState?.sensing ?? {})) {
      for (const key of contentExceptions(layers as string[])) keys.add(key);
    }
    return [...keys];
  }, [debug.worldState]);

  return (
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
            <span>{describeIntent(debug.worldState?.inferredIntent?.label, lang) || "—"}</span>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }} data-testid="sensing-line">
            {t("sensingPrefix", lang)} — {sensingLine} ({t("sensingShapeOnly", lang)}
            {contentExceptionKeys.map((key) => `; ${t(key, lang)}`).join("")})
          </p>
          <div className="divider" style={{ margin: "10px 0" }} />
          <div className="k muted" style={{ fontSize: 12 }}>{t("screenConsentTitle", lang)}</div>
          <div data-testid="screen-consent">
            {["screenConsentWhat", "screenConsentWhere", "screenConsentLeaves", "screenConsentOff"].map((key) => (
              <p key={key} className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
                {t(key, lang)}
              </p>
            ))}
          </div>
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
            {reasonSummary ?? t("presenceNoReason", lang)}
          </p>
          <div className="divider" style={{ margin: "10px 0" }} />
          <div className="k muted" style={{ fontSize: 12 }}>{t("presencePlanned", lang)}</div>
          <p style={{ fontSize: 13, margin: "6px 0 0", fontFamily: approvals.length ? "var(--mono)" : undefined }}>
            {approvals.length ? approvals.map((a) => a.capabilityId).join(", ") : t("presenceNothingPlanned", lang)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
