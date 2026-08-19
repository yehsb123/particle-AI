import { z } from "zod";
import { IsoTimestamp } from "./common";

/**
 * What the user is currently doing with the interface. The morph guard uses this to
 * protect focus and avoid restructuring around active interaction.
 */
export const AttentionState = z.object({
  /** component id the user is currently focused on, if any */
  focusedComponentId: z.string().optional(),
  /** true when the user is actively typing (input/editor) */
  typing: z.boolean().default(false),
  /** last time (ISO) the user interacted; used for dwell/idle heuristics */
  lastInteractionAt: IsoTimestamp.optional(),
});
export type AttentionState = z.infer<typeof AttentionState>;

export const EMPTY_ATTENTION: AttentionState = { typing: false };
