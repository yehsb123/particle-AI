import { describe, it, expect } from "vitest";
import { mergeSuggestions, MAX_SUGGESTIONS, type Suggestion } from "./suggestions";

/**
 * Template suggestions reach the body three ways — from its own core, in the answer to a simulated
 * event, and over the socket when another body's event caused them — and each of those places
 * carried its own copy of the merge, written slightly differently: two kept whatever object
 * arrived, the third mapped it down to the two fields the panel draws.
 *
 * It was also the only list in the body without a ceiling. The log keeps forty, the trace fifty,
 * the audit sixty, the stored event log five hundred. This one grew for as long as the page stayed
 * open, and the runtime's table holding five hundred at a time does not bound it: that table
 * evicts the stalest, so the number of distinct keys offered over a long session has no limit.
 */
const sug = (key: string, count = 3): Suggestion => ({ key, count });

describe("the suggestions the body is holding", () => {
  it("is what it had, plus what has not been offered before", () => {
    expect(mergeSuggestions([], [sug("a"), sug("b")])).toEqual([sug("a"), sug("b")]);
    expect(mergeSuggestions([sug("a")], [sug("b")])).toEqual([sug("a"), sug("b")]);
  });

  it("holds one card per pattern, however many paths deliver it", () => {
    // the same suggestion can arrive from this body's core and over the socket
    const once = mergeSuggestions([], [sug("a")]);
    const twice = mergeSuggestions(once, [sug("a")]);
    const thrice = mergeSuggestions(twice, [sug("a"), sug("a")]);
    expect(thrice).toEqual([sug("a")]);
  });

  it("prints the larger count, because the panel says how many times it happened", () => {
    // a count only ever grows; keeping the first number seen would print something untrue
    expect(mergeSuggestions([sug("a", 3)], [sug("a", 7)])).toEqual([sug("a", 7)]);
    // and a later delivery that is somehow behind does not walk the number backwards
    expect(mergeSuggestions([sug("a", 7)], [sug("a", 3)])).toEqual([sug("a", 7)]);
  });

  it("keeps the two fields the panel draws and nothing that rode along", () => {
    const merged = mergeSuggestions([], [{ key: "a", count: 3, secret: "from the wire", nested: { deep: 1 } }]);
    expect(merged).toEqual([{ key: "a", count: 3 }]);
    expect(Object.keys(merged[0]!)).toEqual(["key", "count"]);
  });

  it("does not grow for as long as the page is open", () => {
    let held: Suggestion[] = [];
    for (let i = 0; i < MAX_SUGGESTIONS * 3; i++) held = mergeSuggestions(held, [sug("pattern-" + i)]);
    expect(held.length).toBe(MAX_SUGGESTIONS);
    // the newest offers are the ones kept
    expect(held.at(-1)).toEqual(sug("pattern-" + (MAX_SUGGESTIONS * 3 - 1)));
  });

  it("stays at the ceiling even when one delivery is larger than the whole list", () => {
    const flood = Array.from({ length: MAX_SUGGESTIONS * 2 }, (_, i) => sug("k" + i));
    expect(mergeSuggestions([sug("held")], flood).length).toBe(MAX_SUGGESTIONS);
  });

  it("skips what is not a suggestion rather than drawing a card for it", () => {
    // these arrive over a socket; a frame that is not what it claims must not become a row
    const merged = mergeSuggestions([sug("real")], [null, undefined, 7, "a", {}, { key: "" }, { count: 3 }, { key: "ok" }]);
    expect(merged).toEqual([sug("real"), { key: "ok", count: 0 }]);
  });

  it("does not take a count that is not a number", () => {
    expect(mergeSuggestions([], [{ key: "a", count: "many" }])).toEqual([{ key: "a", count: 0 }]);
    expect(mergeSuggestions([], [{ key: "a", count: NaN }])).toEqual([{ key: "a", count: 0 }]);
    expect(mergeSuggestions([], [{ key: "a", count: Infinity }])).toEqual([{ key: "a", count: 0 }]);
  });

  it("leaves what it was given alone", () => {
    // the body holds this in state; a merge that edited it in place would change state behind React
    const before: Suggestion[] = [sug("a", 3)];
    const merged = mergeSuggestions(before, [sug("a", 9), sug("b")]);
    expect(before).toEqual([sug("a", 3)]);
    expect(merged).toEqual([sug("a", 9), sug("b")]);
  });
});
