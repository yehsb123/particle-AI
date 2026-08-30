import type { CapabilityManifest } from "@particle/contracts";
import type { Capability, CapabilityContext } from "./types";

function manifest(m: Partial<CapabilityManifest> & Pick<CapabilityManifest, "id" | "name" | "risk">): CapabilityManifest {
  return {
    description: "",
    tags: [],
    latencyClass: "instant",
    costClass: "free",
    requiredPermissions: [],
    ...m,
  };
}

function cap(
  m: CapabilityManifest,
  run: (input: unknown, ctx: CapabilityContext) => unknown,
): Capability {
  return {
    manifest: m,
    async execute(input, ctx) {
      try {
        return { ok: true, output: run(input, ctx) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

/**
 * Initial built-in capabilities. All read-only except `memory.store` (safe_write), which is
 * included specifically to exercise permission gating. External-effect / destructive
 * capabilities are deliberately omitted until the permission flow is in place end to end.
 */
export function builtinCapabilities(memory: Map<string, unknown> = new Map()): Capability[] {
  return [
    cap(
      manifest({ id: "system.get_status", name: "Get system status", risk: "read", tags: ["system"] }),
      (_i, ctx) => ({ processes: ctx.worldState?.environment.processes ?? [] }),
    ),
    cap(
      manifest({ id: "workspace.get_state", name: "Get workspace state", risk: "read", tags: ["workspace"] }),
      (_i, ctx) => {
        const w = ctx.worldState;
        const problems = w?.activeProblems ?? [];
        const files = w?.environment.files ?? [];
        const summary = problems.length
          ? `${problems.length} open problem(s): ${problems.map((p) => p.summary).join("; ")}.`
          : `Nothing broke while you were away. ${files.length ? `Recent files: ${files.slice(-3).join(", ")}.` : "Workspace is calm."}`;
        const juggling = [...new Set((w?.behavior.recentKeys ?? []).slice(-6))];
        const b = w?.behavior;
        const recent = b?.recentEntities ?? [];
        // for the "stuck" context card: the facts behind the inference (identifiers only)
        const stuckRows: string[][] = [
          ["Repeated action", b?.lastActionKey ? `\`${b.lastActionKey}\` ×${b.repeatCount}` : "—"],
          ["Open problems", problems.length ? problems.map((p) => p.kind).join(", ") : "none"],
          ["Recent places", recent.length ? recent.slice(-4).join(", ") : "—"],
        ];
        return {
          activeContext: w?.activeContext ?? {},
          activeProblems: problems,
          goal: w?.currentGoal ?? null,
          summary,
          stuckRows,
          // for the "switching" context card: the few places the person keeps moving between
          juggling: juggling.length
            ? `Moving between: ${juggling.map((k) => `\`${k}\``).join(" · ")}. Pinned here so you don't have to hold them in your head.`
            : "You keep moving between a few places. They are pinned here so you don't have to hold them in your head.",
        };
      },
    ),
    cap(
      manifest({ id: "development.read_logs", name: "Read runtime logs", risk: "read", tags: ["development"] }),
      (_i, ctx) => ({
        lines: ctx.worldState?.activeProblems.length
          ? [
              "GET /users/42 → 500 Internal Server Error",
              "TypeError: Cannot read properties of undefined (reading 'findById')",
              "  at getUser (src/routes.ts:2:19)",
            ]
          : ["no recent errors"],
      }),
    ),
    cap(
      manifest({ id: "development.read_build_state", name: "Read build state", risk: "read", tags: ["development"] }),
      (_i, ctx) => ({
        state: ctx.worldState?.activeProblems.some((p) => p.kind === "build_failure") ? "failing" : "passing",
      }),
    ),
    cap(
      manifest({ id: "development.read_test_state", name: "Read test state", risk: "read", tags: ["development"] }),
      (_i, ctx) => ({
        state: ctx.worldState?.activeProblems.some((p) => p.kind === "test_failure") ? "failing" : "passing",
      }),
    ),
    cap(
      manifest({ id: "data.inspect", name: "Inspect data", risk: "read", tags: ["data"] }),
      (input) => ({ inspected: input ?? null }),
    ),
    cap(
      manifest({ id: "ui.focus_component", name: "Focus a component", risk: "read", tags: ["ui"] }),
      (input) => ({ focus: (input as { componentId?: string })?.componentId ?? null }),
    ),
    cap(
      manifest({ id: "memory.search", name: "Search memory", risk: "read", tags: ["memory"] }),
      (input) => {
        const q = String((input as { query?: string })?.query ?? "").toLowerCase();
        const hits = [...memory.entries()].filter(([k]) => k.toLowerCase().includes(q));
        return { hits: hits.map(([key, value]) => ({ key, value })) };
      },
    ),
    cap(
      manifest({ id: "memory.store", name: "Store memory", risk: "safe_write", tags: ["memory"] }),
      (input) => {
        const { key, value } = (input as { key?: string; value?: unknown }) ?? {};
        if (!key) throw new Error("memory.store requires a key");
        memory.set(key, value);
        return { stored: key };
      },
    ),
    // External-effect capability — reverts the offending diff. Because it changes the world
    // outside the runtime, it requires explicit human approval at the default autonomy level.
    cap(
      manifest({
        id: "development.revert_diff",
        name: "Revert recent diff",
        description: "Reverts the most recent change that likely caused the incident.",
        risk: "external_effect",
        tags: ["development", "remediation"],
        latencyClass: "fast",
      }),
      (input) => ({ reverted: true, target: (input as { target?: string })?.target ?? "recent diff" }),
    ),
    // Network shape (Concept v2, L2): what the runtime knows about traffic - hosts, counts, never content.
    cap(
      manifest({ id: "network.inspect_shape", name: "Inspect network shape", risk: "read", tags: ["network"] }),
      (_i, ctx) => {
        const net = ctx.worldState?.behavior.network ?? { requests: 0, failures: 0, slow: 0, failingHosts: [] };
        return {
          requests: net.requests,
          failures: net.failures,
          slow: net.slow,
          failingHosts: net.failingHosts,
          // table-shaped view for UI bindings
          rows: net.failingHosts.map((h) => [h, "failing"]),
        };
      },
    ),
    // Security scenario: read-only dependency scan + gated remediation.
    cap(
      manifest({ id: "security.scan_dependencies", name: "Scan dependencies", risk: "read", tags: ["security"] }),
      () => ({
        vulnerable: [{ name: "lodash", version: "4.17.20", advisory: "CVE-2026-1234", severity: "critical" }],
        // table-shaped view for UI bindings
        rows: [["lodash@4.17.20", "critical", "CVE-2026-1234"]],
      }),
    ),
    cap(
      manifest({
        id: "security.update_dependency",
        name: "Update dependency",
        description: "Updates a vulnerable dependency to a patched version.",
        risk: "external_effect",
        tags: ["security", "remediation"],
        latencyClass: "fast",
      }),
      (input) => {
        const { pkg, to } = (input as { pkg?: string; to?: string }) ?? {};
        return { updated: `${pkg ?? "lodash"}@${to ?? "4.17.21"}` };
      },
    ),
  ];
}
