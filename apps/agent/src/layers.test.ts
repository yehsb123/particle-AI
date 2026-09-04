import { describe, it, expect } from "vitest";
import { SENSING_LAYERS } from "@particle/contracts";

/**
 * The agent announces which of its senses are on — files, git branches, piped output — and the
 * body shows each by name. The words live with the body, so a layer named here that the shared
 * vocabulary does not know would appear there as a bare identifier.
 */
const LAYERS_THIS_AGENT_REPORTS = ["files", "git", "output"];

describe("the layers this sensor can report", () => {
  it("are all in the vocabulary the body reads", () => {
    for (const layer of LAYERS_THIS_AGENT_REPORTS) {
      expect(SENSING_LAYERS as readonly string[], layer).toContain(layer);
    }
  });
});
