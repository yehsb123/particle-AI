"use client";

/**
 * What the person set, rather than what the runtime decided: language, theme, and the two
 * transient surfaces (the coaching strip and the presence popover).
 *
 * The state lives here and the acts that change it live with it. Writing any of it back to
 * storage does NOT: the saved language is read during the restore, so a persisting effect has to
 * run after that one, and where an effect sits relative to the restore is the body's business.
 */
import { useRef, useState } from "react";
import type { Lang } from "../../lib/i18n";

export function useWorkspaceSettings() {
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");
  const [lang, setLang] = useState<Lang>("en");
  const [showCoach, setShowCoach] = useState(false);
  const [showPresence, setShowPresence] = useState(false);
  const [devMode, setDevMode] = useState(false);

  const applyTheme = (t: "system" | "dark" | "light") => {
    setTheme(t);
    const el = document.documentElement;
    if (t === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", t);
    try { localStorage.setItem("dm_theme", t); } catch {}
  };

  const dismissCoach = () => {
    setShowCoach(false);
    try { localStorage.setItem("dm_coach", "dismissed"); } catch {}
  };
  const dismissCoachRef = useRef(dismissCoach);
  dismissCoachRef.current = dismissCoach;

  return {
    theme,
    setTheme,
    lang,
    setLang,
    showCoach,
    setShowCoach,
    showPresence,
    setShowPresence,
    devMode,
    setDevMode,
    applyTheme,
    dismissCoach,
    dismissCoachRef,
  };
}
