import type { CapabilityManifest, RiskLevel } from "@dm/contracts";
import type { Capability, CapabilityContext } from "@dm/capability-core";

/** Minimal MCP surface we depend on — any transport (stdio, HTTP, ws) can implement it. */
export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  /** optional server-declared risk/annotation hints */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

export interface McpClient {
  readonly serverId: string;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

export type McpAdapterOptions = {
  /** explicit risk override per tool name */
  riskFor?: (tool: McpToolDescriptor) => RiskLevel | undefined;
};

const READ_HINTS = /(^|[._-])(get|list|read|search|fetch|query|describe|inspect)([._-]|$)/i;

/** Classify an MCP tool's risk from annotations, an override, or a name heuristic. */
export function inferRisk(tool: McpToolDescriptor, opts: McpAdapterOptions = {}): RiskLevel {
  const override = opts.riskFor?.(tool);
  if (override) return override;
  if (tool.annotations?.destructiveHint) return "destructive";
  if (tool.annotations?.readOnlyHint) return "read";
  if (READ_HINTS.test(tool.name)) return "read";
  // Unknown external tools are treated as external effects by default (safer).
  return "external_effect";
}

/** Wrap a single MCP tool as a Capability. MCP specifics stay out of the core runtime. */
export function mcpToolToCapability(
  tool: McpToolDescriptor,
  client: McpClient,
  opts: McpAdapterOptions = {},
): Capability {
  const manifest: CapabilityManifest = {
    id: `mcp.${client.serverId}.${tool.name}`,
    name: tool.name,
    description: tool.description ?? `MCP tool ${tool.name} from ${client.serverId}`,
    tags: ["mcp", client.serverId],
    risk: inferRisk(tool, opts),
    latencyClass: "slow",
    costClass: "medium",
    requiredPermissions: [`mcp:${client.serverId}`],
  };
  return {
    manifest,
    async execute(input: unknown, _ctx: CapabilityContext) {
      try {
        const output = await client.callTool(tool.name, input ?? {});
        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

/** Discover all tools from an MCP client and normalise them into capabilities. */
export async function discoverMcpCapabilities(
  client: McpClient,
  opts: McpAdapterOptions = {},
): Promise<Capability[]> {
  const tools = await client.listTools();
  return tools.map((t) => mcpToolToCapability(t, client, opts));
}
