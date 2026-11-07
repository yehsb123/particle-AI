"use client";

/**
 * What happened, in the order it happened: events in, morphs out, and everything that was refused.
 *
 * Lines are written through the renderer's text helper before they get here, because this is one
 * of the three surfaces that shows values from outside — the names in it were written by a model
 * or by another machine, not by this one.
 */
import React from "react";
import { t, type Lang } from "../../lib/i18n";
import type { LogEntry } from "./session";

export function ActivityLog({ lang, log }: { lang: Lang; log: LogEntry[] }) {
  return (
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
  );
}
