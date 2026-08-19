# Runtime loop

The runtime is a single explicit `ingest(event)` function that threads an event through
independent modules. Each stage is pure or side-effect-isolated and separately tested.

```ts
async function ingest(event: MatterEvent) {
  await eventStore.append(event);

  const previous = await worldState.get(event.sessionId);
  const updated = worldModel.reduce(previous, event);          // pure reducer

  const significance = significanceEngine.evaluate(event, updated); // deterministic
  await worldState.persist(updated);

  if (!significance.shouldDeliberate) {                        // reflex-only path
    publishState(updated);
    return;
  }

  const route = intelligenceRouter.route({ event, worldState: updated, significance });
  const decision = await decisionEngine.evaluate({ event, worldState: updated, route });

  const authorizedPlan = permissionEngine.evaluate(decision);  // pure
  const capabilityResults = await capabilityExecutor.executeAuthorized(authorizedPlan);

  const desiredUI = morphologyPlanner.plan({ worldState: updated, decision, capabilityResults });
  const safePatch = morphGuard.validate({                      // pure: cooldown/dwell/focus
    currentUI: updated.uiState,
    desiredUI,
    currentInteraction: updated.attention,
  });

  await uiStore.apply(safePatch);
  publish(safePatch);
  await audit.complete({ event, significance, route, decision, capabilityResults, safePatch });
}
```

## Why two paths

Most events are noise. The cheap `significanceEngine` decides whether to spend a
deliberation cycle. Only significant events reach the router / decision engine / model.
This keeps the system cheap, fast, and functional without any model.

## Replay

Every stage's input/output is persisted (event, world state before/after, significance,
route, decision, capability runs, UI patch, audit). A developer can replay a session and
answer: *why did the UI change, which event triggered it, which model was used, which
capabilities ran, was approval required, what was the result?*
