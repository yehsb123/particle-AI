import { z } from "zod";

/** Output of the cheap, deterministic significance evaluation. */
export const SignificanceResult = z.object({
  /** 0..1 significance score */
  score: z.number().min(0).max(1),
  reasonCodes: z.array(z.string()),
  /** whether this event warrants a deep-brain deliberation cycle */
  shouldDeliberate: z.boolean(),
});
export type SignificanceResult = z.infer<typeof SignificanceResult>;
