import { describe, it, expect } from "vitest";
import { ACCOUNT_LINK_KINDS, ACCOUNT_LINK_REASONS, ACCOUNT_LINK_STATES } from "@particle/contracts";
import { t } from "./i18n";

/**
 * Every word the account-link view puts on screen, in both languages.
 *
 * `t()` answers with the key itself when a key is missing, so a Korean screen showing
 * `link_state_not_operable` is what a forgotten translation looks like. Asking whether the answer
 * differs from the key would miss the other half of it: an entry copied from English into the
 * Korean slot is present, passes that check, and still shows English to a Korean reader.
 *
 * So the question here is whether the two languages say different things. A missing key fails it
 * (both answers are the key) and a copied one fails it too, which is the point.
 */
const KEYS = [
  ...ACCOUNT_LINK_KINDS.map((kind) => `link_kind_${kind}`),
  ...ACCOUNT_LINK_STATES.map((state) => `link_state_${state}`),
  ...ACCOUNT_LINK_REASONS.map((reason) => `link_reason_${reason}`),
  "accountLinksTitle",
];

describe("the words for a linked account", () => {
  it("says each of them differently in English and Korean", () => {
    const untranslated = KEYS.filter((key) => t(key, "en") === t(key, "ko"));
    expect(untranslated).toEqual([]);
  });

  it("says something for each of them in each language", () => {
    const blank = KEYS.filter((key) => !t(key, "en").trim() || !t(key, "ko").trim());
    expect(blank).toEqual([]);
  });

  it("covers the whole vocabulary, so a new state cannot arrive without words", () => {
    expect(KEYS).toHaveLength(ACCOUNT_LINK_KINDS.length + ACCOUNT_LINK_STATES.length + ACCOUNT_LINK_REASONS.length + 1);
  });
});
