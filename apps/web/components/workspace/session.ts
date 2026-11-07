"use client";

/**
 * Which session this body is, where it keeps its log, and what time it is while a log is replayed.
 *
 * All of it is module-level on purpose. The session is read off the address bar once — the main
 * tab and the extension side panel share an origin but not a log — and the restore gate has to be
 * readable by an event that arrives before the component that opened it has finished mounting.
 */
import type { PresenceState } from "@particle/contracts";
import { createReplayClock } from "../../lib/replayClock";

/** One list, in the contracts, so the runtime and the body cannot drift on what a presence is. */
export type Presence = PresenceState;
export type LogEntry = { id: string; text: string; kind: "event" | "morph" | "blocked" | "undo" | "note" };

/**
 * Why a call to the runtime did not go through, in words the log can carry.
 *
 * A refused answer and an unreachable runtime are different things to the person reading the log:
 * one means the token or the session is wrong, the other means nothing is listening. The client
 * names the call and the status in its own message, so both arrive here already said.
 */
export const whyNot = (err: unknown): string => (err instanceof Error ? err.message : "the runtime could not be reached");

export type Inspector = {
  lastEvent?: string;
  significance?: number;
  deliberated?: boolean;
  provider?: string;
  usedFallback?: boolean;
  reasonSummary?: string;
  confidence?: number;
  capabilities: string[];
  permission?: { authorized: string[]; needsApproval: string[]; denied: string[] };
  morphApplied?: boolean;
  guardReasonCodes: string[];
  dropped: string[];
};

/** One entry in the history strip: a morph that was applied, and when. */
export type MorphStep = { id: string; intent: string; at: string };
/** A morph the guards would not let through, and when it may be tried again. */
export type HeldMorph = { codes: string[]; at: number; retryMs?: number };
/** What was learned from repeated dismissals: which card is suppressed, and after how many. */
export type Learned = { suppressed: string; dismissals: number };

export const SESSION =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("session") ?? "session-local" : "session-local";
export const AUTO_CONNECT = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("connect") === "1";
// While restoring a saved log, "now" is the replayed event's own timestamp, and it only ever
// moves forward (see lib/replayClock).
export const replayClock = createReplayClock();
export const nowIso = () => replayClock.iso();
export const nowMs = () => replayClock.ms();
// Storage is per session: the main tab and the extension side panel share an origin but not a log.
export const EVENTS_KEY = `dm_events:${SESSION}`;
export const PREFS_KEY = `dm_prefs:${SESSION}`;
// Live events wait until the saved log has been replayed, so nothing is stamped with a replayed
// timestamp or written over the log mid-restore. Resolved immediately when there is nothing to restore.
let release: () => void = () => {};
let restoreGate: Promise<void> = Promise.resolve(); // re-created per restore (see below)
export const restoredCores = new WeakSet<object>(); // StrictMode double-mounts share a core — replay once; a real remount gets a new core and restores again

/** Shut the gate: live events queue behind the restore that is about to start. */
export function holdLiveEvents(): void {
  restoreGate = new Promise((r) => { release = r; });
}
/** Let them through. Called on every path out of a restore, including the ones that failed. */
export function releaseRestore(): void {
  release();
}
/** What an arriving event waits on before it is ingested. */
export function waitForRestore(): Promise<void> {
  return restoreGate;
}
