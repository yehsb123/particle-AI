import type { CapabilityManifest, RiskLevel } from "@particle/contracts";
import type { Capability, CapabilityContext } from "@particle/capability-core";

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

/**
 * A tool name split into lowercase words: delimiters and camelCase humps both count, so
 * `getWeather`, `get_weather`, `GET_ALL` and `x.get.y` all yield a `get` word, while `getter`
 * and `listen` stay single words that mean nothing to us.
 */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(" "))
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

const READ_WORDS = new Set(["get", "list", "read", "search", "fetch", "query", "describe", "inspect", "find", "show", "status"]);
/** Words that mean the tool changes something outside the runtime. */
const MUTATION_WORDS = new Set([
  "write", "update", "create", "insert", "upsert", "set", "patch", "put", "post", "send", "exec",
  "execute", "run", "spawn", "start", "stop", "restart", "reset", "kill", "install", "uninstall",
  "deploy", "publish", "grant", "revoke", "move", "rename", "copy", "add", "remove", "edit", "apply",
]);
/** Words that mean the tool destroys something. Tight on purpose — no room for doubt. */
const DESTRUCTIVE_WORDS = new Set(["delete", "destroy", "drop", "wipe", "purge", "truncate", "format", "erase"]);

/**
 * Classify an MCP tool's risk. A caller's own override wins over everything; after that the
 * name decides when it says something unambiguous, because a mistake here is a capability that
 * runs without asking. A destructive word beats a server's read-only hint (a server calling
 * `delete_all` read-only is either wrong or lying, and the cost of believing it is data loss),
 * and a mutating word anywhere in the name keeps a read verb from making it auto-runnable —
 * `fetch_and_delete_logs` is not a read. Anything we cannot read confidently is an external
 * effect, which needs approval below full autonomy.
 */
export function inferRisk(tool: McpToolDescriptor, opts: McpAdapterOptions = {}): RiskLevel {
  const override = opts.riskFor?.(tool);
  if (override) return override;

  const words = nameWords(tool.name);
  const destructiveName = words.some((w) => DESTRUCTIVE_WORDS.has(w));
  if (tool.annotations?.destructiveHint || destructiveName) return "destructive";
  if (tool.annotations?.readOnlyHint) return "read";

  const mutates = words.some((w) => MUTATION_WORDS.has(w));
  if (!mutates && words.some((w) => READ_WORDS.has(w))) return "read";
  // Anything else is treated as an external effect — the safer default.
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
