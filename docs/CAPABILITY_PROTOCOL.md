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
`ui.focus_component`, `memory.search`, `security.scan_dependencies`. Plus `memory.store`
(safe_write) to exercise gating.

External effect (approval-gated at the default autonomy level, auto at L4):
`development.revert_diff` (runtime/build/test incidents) and `security.update_dependency`
(security alerts). The deterministic brain picks a plan per problem kind (`planFor(kind)`).

Outputs double as UI data: `read_logs.lines` and `scan_dependencies.rows` are bound into the
incident layouts via `UIComponent.bindings` (see `UI_PROTOCOL.md`).

## MCP as a capability source

`@particle/mcp-adapter` turns any MCP tool into a `Capability` (`mcp.<server>.<tool>`), inferring
risk from annotations, an override, or a name heuristic. The core runtime does not care
whether an ability came from native code or MCP — it only sees the `Capability` interface.
