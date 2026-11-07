"use client";

/**
 * A morph the guards would not let through, said out loud.
 *
 * A body that silently refuses to change is indistinguishable from one that had nothing to say,
 * so the reason codes and the moment it may be tried again are both on screen.
 */
import React from "react";
import { describeHold } from "../../lib/hold";
import { fillTemplate, t, type Lang } from "../../lib/i18n";
import type { HeldMorph } from "./session";

export function HeldNotice({ lang, held, onDismiss }: { lang: Lang; held: HeldMorph; onDismiss: () => void }) {
  return (
    <div className="held" role="status">
      <span className="badge warn"><span className="dot" />{t("heldTitle", lang)}</span>
      <span>
        {describeHold(held.codes, lang)}
        {held.retryMs !== undefined ? <b> · {fillTemplate(t("heldRetry", lang), { s: Math.ceil(held.retryMs / 1000) })}</b> : null}
      </span>
      <button className="btn muted" style={{ padding: "2px 10px" }} onClick={onDismiss}>✕</button>
    </div>
  );
}
