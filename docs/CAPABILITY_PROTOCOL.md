# Capability Protocol

Capabilities are the AI's abilities — "digital matter" the runtime can assemble. Whatever
their origin (native TypeScript, MCP, HTTP, a future plugin), they share one interface.

## Manifest + execute

```ts
interface Capability {
  manifest: CapabilityManifest; // id, name, description, tags, risk, latencyClass, costClass, requiredPermissions
  execute(input, context): Promise<CapabilityResult>; // { ok, output?, error? }
}
```

`risk` is one of `read | safe_write | external_effect | destructive` and drives permission
gating (see `AUTONOMY_AND_SECURITY.md`).

## Registry & executor

- `CapabilityRegistry` holds all abilities and answers `riskOf(id)` for the permission engine.
- `CapabilityExecutor` runs a plan and records an auditable `CapabilityRun` per execution
  (id, capabilityId, startedAt/finishedAt, ok, error). Unknown ids and thrown errors become
  failed results + runs, never crashes.

## Built-ins (MVP)

Read-only: `system.get_status`, `workspace.get_state`, `development.read_logs`,
`development.read_build_state`, `development.read_test_state`, `data.inspect`,
`ui.focus_component`, `memory.search`. Plus `memory.store` (safe_write) to exercise gating.
External-effect / destructive capabilities are intentionally deferred until the approval
flow is exercised end to end.

## MCP as a capability source

`@particle/mcp-adapter` turns any MCP tool into a `Capability` (`mcp.<server>.<tool>`), inferring
risk from annotations, an override, or a name heuristic. The core runtime does not care
whether an ability came from native code or MCP — it only sees the `Capability` interface.
