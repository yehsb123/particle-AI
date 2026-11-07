"use client";

/**
 * The body's end of the connected runtime: one socket, one mode, and the patches that arrive on it.
 *
 * Local and connected are two different brains for the same body, and everything that differs
 * between them lives here — which runtime is in charge, whether its socket is up, what to do with
 * a message it pushes, and the shape-level summaries of the other bodies on it. The body keeps
 * its own state; this hook is what writes into it on the runtime's behalf.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalRequest, SessionSummary, UIBlueprint } from "@particle/contracts";
import type { RuntimeCore } from "@particle/runtime-core";
import type { DebugState } from "../DeveloperInspector";
import { RuntimeClient, type ServerMessage } from "../../lib/runtimeClient";
import { mergeSuggestions, type Suggestion } from "../../lib/suggestions";
import { AUTO_CONNECT, SESSION, whyNot, type Learned, type LogEntry, type Presence } from "./session";

/** Everything the runtime is allowed to change in the body it is driving. */
export type ConnectionBody = {
  core: React.RefObject<RuntimeCore>;
  pushLog: (text: string, kind: LogEntry["kind"]) => void;
  addApprovals: (incoming: ApprovalRequest[]) => void;
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  setBlueprint: React.Dispatch<React.SetStateAction<UIBlueprint>>;
  setCanUndo: React.Dispatch<React.SetStateAction<boolean>>;
  setPresence: React.Dispatch<React.SetStateAction<Presence>>;
  setDebug: React.Dispatch<React.SetStateAction<DebugState>>;
  setPatternSugs: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  setLearned: React.Dispatch<React.SetStateAction<Learned | null>>;
};

export function useRuntimeConnection(body: ConnectionBody) {
  const { core, pushLog, addApprovals, setApprovals, setBlueprint, setCanUndo, setPresence, setDebug, setPatternSugs, setLearned } = body;
  const [mode, setMode] = useState<"local" | "connected">("local");
  const [connected, setConnected] = useState(false);
  const [otherSessions, setOtherSessions] = useState<SessionSummary[]>([]);
  const client = useRef<RuntimeClient | null>(null);
  /** Whether a runtime switch is already in flight; see toggleMode. */
  const switching = useRef(false);

  const handleServerMessage = useCallback(
    (m: ServerMessage) => {
      if (m.kind === "ui_patch") {
        setBlueprint(m.blueprint);
        setCanUndo(true);
        setPresence("acting");
        pushLog("server morph → ui_patch", "morph");
        setTimeout(() => setPresence("observing"), 600);
      } else if (m.kind === "world_state_changed") {
        setDebug((d) => ({ ...d, worldState: m.worldState }));
      } else if (m.kind === "ai_presence_changed") {
        setPresence(m.state);
      } else if (m.kind === "pattern_suggestions") {
        setPatternSugs((p) => mergeSuggestions(p, m.suggestions));
      } else if (m.kind === "learned") {
        setLearned(m.learned);
      } else if (m.kind === "decision_created") {
        setDebug((d) => ({ ...d, audit: [...m.audit, ...d.audit].slice(0, 60) }));
        pushLog("server decision", "note");
      } else if (m.kind === "approval_asked") {
        // this body may not be the one whose event caused the question
        addApprovals(m.approvals);
      } else if (m.kind === "approval_decided") {
        // somebody decided this one — here, in another tab, or in the side panel
        setApprovals((a) => a.filter((x) => x.id !== m.approvalId));
        pushLog(`approval ${m.decision} (server)`, m.decision === "approved" ? "morph" : "note");
      }
    },
    [pushLog, addApprovals, setApprovals, setBlueprint, setCanUndo, setPresence, setDebug, setPatternSugs, setLearned],
  );

  const toggleMode = useCallback(async () => {
    // One switch at a time. `mode` is state, and the switch awaits the runtime's first answer
    // before it is written, so a second entry in that window still read "local", built a second
    // client over the first and left the first socket with nobody holding a handle to close it —
    // two sockets pushing patches into one body. It takes no user: the embedded body calls this
    // from an effect, and React's strict mode runs a mount effect twice.
    if (switching.current) return;
    switching.current = true;
    try {
      // approvals/audit are per-runtime; clear cross-mode state when switching runtimes.
      setApprovals([]);
      if (mode === "local") {
        const c = new RuntimeClient(SESSION);
        client.current?.disconnect(); // never leave one open with nothing pointing at it
        client.current = c;
        c.connect(handleServerMessage, setConnected);
        setMode("connected"); // committed before the await: nothing below changes it
        try {
          const fromServer = await c.getUI();
          // Keeping what is on screen beats replacing it with nothing: the socket may still bring
          // a patch this build can read, and an unreadable answer is a different thing from
          // silence.
          if (client.current !== c) return; // superseded while we waited
          if (fromServer) setBlueprint(fromServer);
          else pushLog("runtime answered with a body this build cannot read", "blocked");
        } catch (err) {
          pushLog(`could not reach runtime server (pnpm runtime) — ${whyNot(err)}`, "blocked");
        }
      } else {
        client.current?.disconnect();
        client.current = null;
        setConnected(false);
        setMode("local");
        setBlueprint(core.current.getBlueprint(SESSION));
        pushLog("switched to local runtime", "note");
      }
    } finally {
      switching.current = false;
    }
  }, [mode, handleServerMessage, pushLog, core, setApprovals, setBlueprint]);

  // Multi-session view: while connected, poll the runtime's shape-level session summaries.
  useEffect(() => {
    if (mode !== "connected") {
      setOtherSessions([]);
      return;
    }
    let alive = true;
    const tick = () => {
      void client.current?.sessions().then((list) => {
        if (alive) setOtherSessions(list);
      }).catch(() => undefined);
    };
    tick();
    const t = setInterval(tick, 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mode]);

  // Embedded body (extension side panel opens /?connect=1&session=ext): connect to the runtime once.
  const toggleModeRef = useRef(toggleMode);
  toggleModeRef.current = toggleMode;
  useEffect(() => {
    if (AUTO_CONNECT) void toggleModeRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mode, connected, client, otherSessions, toggleMode };
}
