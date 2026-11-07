"use client";

/**
 * Every morph this body has been through, as a strip you can step back into.
 *
 * Only the local runtime has one: the history is the undo stack of the core in this tab, and a
 * server runtime keeps its own.
 */
import React from "react";
import { describeMorphStep } from "../../lib/morphStep";
import { t, type Lang } from "../../lib/i18n";
import type { MorphStep } from "./session";

export function HistoryStrip({ lang, morphs, onUndoTo }: { lang: Lang; morphs: MorphStep[]; onUndoTo: (i: number) => void }) {
  return (
    <div className="history" aria-label={t("historyTitle", lang)}>
      <span className="history-title">{t("historyTitle", lang)}</span>
      {morphs.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>{t("historyEmpty", lang)}</span>
      ) : (
        morphs.map((m, i) => (
          <button key={`${m.id}-${i}`} className="chip" title={t("historyHint", lang)} onClick={() => onUndoTo(i)}>
            <span className="n">{i + 1}</span> {describeMorphStep(m.intent, lang)} <span className="muted">{m.at}</span>
          </button>
        ))
      )}
    </div>
  );
}
