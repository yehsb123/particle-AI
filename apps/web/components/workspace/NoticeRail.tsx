"use client";

/**
 * The three things the body raises that are addressed to the person rather than to the screen:
 * a pattern it noticed, something it learned from being dismissed, and a question it must have
 * answered before an outward-facing capability may run.
 *
 * The approval card is the consent surface, so it names the capability, its risk, and which
 * permission is missing — never just "allow?".
 */
import React from "react";
import type { ApprovalRequest } from "@particle/contracts";
import { describeApprovalReason, missingPermissionNames } from "../../lib/approval";
import { describeRisk, riskBadgeClass } from "../../lib/risk";
import { t, type Lang } from "../../lib/i18n";
import type { Suggestion } from "../../lib/suggestions";
import type { Learned } from "./session";

export function NoticeRail({
  lang,
  patternSugs,
  setPatternSugs,
  learned,
  setLearned,
  approvals,
  onDecide,
}: {
  lang: Lang;
  patternSugs: Suggestion[];
  setPatternSugs: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  learned: Learned | null;
  setLearned: React.Dispatch<React.SetStateAction<Learned | null>>;
  approvals: ApprovalRequest[];
  onDecide: (approval: ApprovalRequest, accept: boolean) => void;
}) {
  return (
    <>
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
                  <span className={riskBadgeClass(a.risk)}><span className="dot" />{describeRisk(a.risk, lang)}</span>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  {describeApprovalReason(a, lang)}
                  {missingPermissionNames(a).map((p) => (
                    <span key={p} style={{ fontFamily: "var(--mono)", marginLeft: 6 }}>{p}</span>
                  ))}
                </p>
                <div className="simrow">
                  <button className="btn primary" onClick={() => onDecide(a, true)}>{t("approve", lang)}</button>
                  <button className="btn muted" onClick={() => onDecide(a, false)}>{t("reject", lang)}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
