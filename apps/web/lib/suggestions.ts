/**
 * The template suggestions the body is holding.
 *
 * They arrive three ways — from this body's own core when it ran the loop, in the answer to a
 * simulated event, and over the socket when another body's event caused them — and each of those
 * three places carried its own copy of the same merge, written slightly differently. Two spread
 * whatever object arrived; the third mapped it down to the two fields the panel draws.
 *
 * It was also the only list in the body without a ceiling. The log keeps forty, the trace fifty,
 * the audit sixty, the stored event log five hundred; this one grew for as long as the page was
 * open. The runtime's own table holds five hundred at a time and evicts the stalest, so the number
 * of distinct keys it can offer over a long session is not five hundred — it is unbounded.
 *
 * The ceiling has a cost worth naming: a pattern is offered ONCE, ever — the runtime marks it
 * suggested and will not raise it again — so a suggestion pushed out of this list does not come
 * back. That is why the ceiling is set well above what a session realistically produces (a pattern
 * needs three repetitions before it is even a candidate) rather than tight: it is a stop, not a
 * working limit, and the newest offers are the ones kept.
 */
export const MAX_SUGGESTIONS = 50;

export type Suggestion = { key: string; count: number };

/**
 * What the body should hold after some suggestions arrive.
 *
 * Same key, higher count wins: the panel prints "this happened N times", and the count only ever
 * grows, so keeping the first number seen would print something untrue once a second path
 * delivered the same pattern again.
 */
export function mergeSuggestions(existing: readonly Suggestion[], incoming: readonly unknown[]): Suggestion[] {
  const merged = existing.map((s) => ({ key: s.key, count: s.count }));
  const at = new Map(merged.map((s, i) => [s.key, i]));
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const { key, count } = raw as { key?: unknown; count?: unknown };
    if (typeof key !== "string" || !key) continue;
    const times = typeof count === "number" && Number.isFinite(count) ? count : 0;
    const seen = at.get(key);
    if (seen !== undefined) {
      const held = merged[seen];
      if (held && times > held.count) held.count = times;
      continue;
    }
    at.set(key, merged.length);
    merged.push({ key, count: times });
  }
  // the newest offers are the ones kept; see the note above about what dropping one costs
  return merged.length > MAX_SUGGESTIONS ? merged.slice(-MAX_SUGGESTIONS) : merged;
}
