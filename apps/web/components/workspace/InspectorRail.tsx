"use client";

/**
 * Why the body is the way it is, for the last event it saw: how significant it was, whether it was
 * deliberated, which brain answered, what ran, and what the guards stopped.
 *
 * Hard rule #7 — every autonomous decision is auditable — is what this panel is for, which is why
 * a morph that did NOT happen names its reason codes rather than leaving the panel empty.
 */
import React from "react";
import { t, type Lang } from "../../lib/i18n";
import type { Inspector } from "./session";

export function InspectorRail({ lang, inspector }: { lang: Lang; inspector: Inspector }) {
  return (
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
  );
}
