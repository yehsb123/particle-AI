"use client";

/**
 * The developer surface: replay the session's event log through a fresh core, and look inside.
 *
 * Replay is the determinism check from spec §21 — the same events through a new core must rebuild
 * the same body — and what it answers sits next to the inspector that explains why the body is
 * the way it is.
 */
import React from "react";
import { t, type Lang } from "../../lib/i18n";
import { DeveloperInspector, type DebugState } from "../DeveloperInspector";

export type ReplayResult = "identical" | "differs" | "none" | null;

export function DevPanel({
  lang,
  debug,
  replayResult,
  onReplayVerify,
}: {
  lang: Lang;
  debug: DebugState;
  replayResult: ReplayResult;
  onReplayVerify: () => void;
}) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div className="simrow" style={{ alignItems: "center", marginBottom: 10 }}>
        <button className="btn" onClick={onReplayVerify}>{t("replayBtn", lang)}</button>
        {replayResult ? (
          <span className={`badge ${replayResult === "identical" ? "ok" : replayResult === "differs" ? "warn" : ""}`}>
            <span className="dot" />
            {replayResult === "identical" ? t("replayIdentical", lang) : replayResult === "differs" ? t("replayDiffers", lang) : t("replayNone", lang)}
          </span>
        ) : null}
      </div>
      <DeveloperInspector debug={debug} lang={lang} />
    </div>
  );
}
