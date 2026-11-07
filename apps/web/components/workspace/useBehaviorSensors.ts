"use client";

/**
 * What this page itself senses about the person in front of it (Concept v2, L0/L3).
 *
 * Shape only: that interaction happened, that the tab came back, that nothing has happened for a
 * while. Never which key, which target, or what was typed. The page announces exactly these
 * layers when it starts, because the "sensing" indicator is derived from what sensors report
 * rather than from what the body believes about itself.
 *
 * Nothing is sensed while a server runtime is in charge — that body's senses are the runtime's.
 */
import React, { useEffect } from "react";
import type { MatterEvent } from "@particle/contracts";
import { SESSION, nowIso } from "./session";

export function useBehaviorSensors(
  ingestRef: React.RefObject<(event: MatterEvent) => Promise<void>>,
  modeRef: React.RefObject<"local" | "connected">,
): void {
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
}
