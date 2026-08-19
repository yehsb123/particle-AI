# Morph Engine

Turns a desired interface into a **safe, reversible** change to the current interface.

## Pipeline

```
current UI + desired UI
        ↓ diff
raw patch (add/remove/replace/move/updateProps/…)
        ↓ MorphGuard
safe patch (possibly reduced, deferred, or rejected)
        ↓ apply (produces inverse patch)
new UI + history entry
```

## MorphGuard — stability

Autonomous UI is annoying if it jumps around. The guard evaluates a proposed change
against a `MorphPolicy` (configuration, not scattered constants):

- **Confidence gates:** normal morphs need `confidence >= 0.75`; large transformations
  need `>= 0.85`.
- **Cooldown:** minimum seconds between morphs (default 5s); major workspace changes have a
  minimum dwell time (default 8s) before another major change.
- **Focus protection:** if the user is typing into an input/editor, changes that would
  remove, replace, or move the focused component (or its ancestors) are suppressed or
  deferred. Focus is preserved whenever possible.
- **Never destroy unsaved state:** removals of components holding unsaved work are blocked.
- **Critical bypass:** `critical` severity events may bypass the normal cooldown (but not
  the unsaved-state rule).

The guard returns either the (possibly trimmed) patch or a rejection with reason codes, so
the decision is auditable.

## Reversibility

`applyPatch(ui, patch)` returns `{ next, inverse }`. The inverse is pushed onto a bounded
history stack. `undo()` applies the top inverse. The renderer always reflects the current
UI; the user is never forced to accept the AI's interpretation.
