import { describe, it, expect } from "vitest";
import { SENSING_LAYERS } from "@particle/contracts";
import { consentLayers, DEFAULT_CONSENT } from "./shape";

/**
 * What this extension says it watches is shown to the person by name, and the words for each
 * name live with the body. A layer this sensor reports that the shared vocabulary does not know
 * would appear there as a bare identifier.
 */
describe("the layers this sensor can report", () => {
  it("are all in the vocabulary the body reads", () => {
    const every = consentLayers({ interactions: true, tabs: true, network: true });
    expect(every.length).toBeGreaterThan(0);
    for (const layer of every) {
      expect(SENSING_LAYERS as readonly string[], layer).toContain(layer);
    }
  });

  it("are still all known with only some consent given", () => {
    for (const consent of [
      { interactions: true, tabs: false, network: false },
      { interactions: false, tabs: true, network: false },
      { interactions: false, tabs: false, network: true },
      DEFAULT_CONSENT,
    ]) {
      for (const layer of consentLayers(consent)) {
        expect(SENSING_LAYERS as readonly string[], layer).toContain(layer);
      }
    }
  });
});
