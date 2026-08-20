# Memory

The AI's **experience** (`@particle/memory`). Per spec §20 we do NOT implement autonomous
self-modifying code — we implement **pattern detection first** and only ever *suggest*
reusable templates.

## Four memory types

- **Working** (`WorkingMemory`) — current-task scratch key/value, cleared per session/goal.
- **Episodic** (`EpisodicMemory`) — notable prior situations (`{ context, summary, eventTypes }`),
  bounded ring, searchable by context.
- **Preference** (`PreferenceMemory`) — count-weighted signals reinforced over time
  (e.g. `morph:surface_incident`), rankable via `top(n)`.
- **Pattern** (`PatternDetector`) — repeated `context→behaviour` keys. When a key crosses the
  threshold it becomes a **candidate** for a reusable workspace template. `takeSuggestions()`
  offers each candidate once; the human/reviewer decides whether to create a template.

`MemorySystem` aggregates all four.

## How the runtime uses it

On each applied morph, `RuntimeCore`:

- records an **episode** (`recommendedMode.intent`, the decision's `reasonSummary`),
- reinforces a **preference** (`morph:<intent>`),
- observes a **pattern** (`<eventType>-><intent>`), and
- returns any fresh **pattern suggestions** in `IngestResult.patternSuggestions`.

The web **Developer Inspector → Memory** tab surfaces episodes, top preferences, and pattern
candidates live.

## Not yet (deferred research — see ROADMAP)

Automatic capability mutation and self-growing workflows. The detector marks *candidates*;
turning a candidate into a real template stays a deliberate, reviewed action.
