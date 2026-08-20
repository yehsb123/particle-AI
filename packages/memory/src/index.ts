export * from "./types";
export * from "./stores";
export * from "./pattern";

import { WorkingMemory, EpisodicMemory, PreferenceMemory } from "./stores";
import { PatternDetector } from "./pattern";

/** The AI's experience: working scratch, episodic recall, preferences, and pattern detection. */
export class MemorySystem {
  readonly working = new WorkingMemory();
  readonly episodic = new EpisodicMemory();
  readonly preferences = new PreferenceMemory();
  readonly patterns: PatternDetector;

  constructor(patternThreshold = 3) {
    this.patterns = new PatternDetector(patternThreshold);
  }
}
