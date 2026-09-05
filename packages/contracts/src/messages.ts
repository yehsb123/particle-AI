import { z } from "zod";
import type { ApprovalRequest, AuditRecord } from "./capability";
import type { UIBlueprint } from "./ui";
import type { WorldState } from "./worldstate";

/**
 * What the runtime says to a body that is watching a session.
 *
 * Both sides used to declare this union separately — the runtime as what it sends, the body as
 * what it accepts — and they had already diverged on what a decision frame carries. A kind one
 * side sends and the other has never heard of is dropped in silence, so the two lists have to be
 * one list.
 */
export const RUNTIME_MESSAGE_KINDS = [
  "world_state_changed",
  "ui_patch",
  "ai_presence_changed",
  "decision_created",
  "learned",
  "pattern_suggestions",
  "approval_asked",
  "approval_decided",
] as const;
export type RuntimeMessageKind = (typeof RUNTIME_MESSAGE_KINDS)[number];

/**
 * What the AI is doing right now, as the body shows it: a dot with a word beside it.
 *
 * The runtime declared this union where it decides the next one, the body declared its own copy,
 * and the frame that carries it between them was checked only for being a string. Any string was
 * therefore a presence — an empty one, a five thousand character one — and the body put it beside
 * the dot verbatim, because a word it has no translation for is shown as itself.
 */
export const AI_PRESENCE_STATES = ["idle", "observing", "evaluating", "acting", "waiting_for_approval"] as const;
export type PresenceState = (typeof AI_PRESENCE_STATES)[number];
export const PresenceStateSchema = z.enum(AI_PRESENCE_STATES);

/** What became of a capability a person was asked about. */
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);

export type RuntimeMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: PresenceState }
  | { kind: "decision_created"; sessionId: string; audit: AuditRecord[] }
  | { kind: "learned"; sessionId: string; learned: { suppressed: string; dismissals: number } }
  | { kind: "pattern_suggestions"; sessionId: string; suggestions: { key: string; count: number }[] }
  /**
   * The runtime is asking a person before it runs something. Only the body whose own event caused
   * this used to learn of it, from the answer to that call — every other body watching the session
   * was told the runtime was waiting for approval and given nothing to answer with.
   */
  | { kind: "approval_asked"; sessionId: string; approvals: ApprovalRequest[] }
  /**
   * A capability the runtime proposed has been decided on. One body asking is not the only body
   * watching: the same session can be open in another tab and in the extension's side panel, and
   * whichever one did not click was left holding a card for something already settled.
   */
  | { kind: "approval_decided"; sessionId: string; approvalId: string; decision: ApprovalDecision };

export type RuntimeListener = (msg: RuntimeMessage) => void;
