import { CapabilityManifest } from "@particle/contracts";
import type { RiskLevel } from "@particle/contracts";
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
 * runs without asking. A destructive or mutating word beats a server's read-only hint (a server
 * calling `delete_all` or `send_email` read-only is either wrong or lying, and the cost of
 * believing it is data loss or a side effect nobody approved), and a mutating word anywhere in
 * the name keeps a read verb from making it auto-runnable —
 * `fetch_and_delete_logs` is not a read. Anything we cannot read confidently is an external
 * effect, which needs approval below full autonomy.
 */
export function inferRisk(tool: McpToolDescriptor, opts: McpAdapterOptions = {}): RiskLevel {
  const override = opts.riskFor?.(tool);
  if (override) return override;

  const words = nameWords(tool.name);
  const destructiveName = words.some((w) => DESTRUCTIVE_WORDS.has(w));
  if (tool.annotations?.destructiveHint || destructiveName) return "destructive";

  // Before any hint is believed: a name that says it changes something outside is read the same
  // way whoever wrote the hint is. A hint is the server's own word about itself, and a read runs
  // without asking anybody, so `send_email` marked read-only would be the whole approval gate
  // skipped on that server's say-so.
  const mutates = words.some((w) => MUTATION_WORDS.has(w));
  if (mutates) return "external_effect";

  if (tool.annotations?.readOnlyHint) return "read";
  if (words.some((w) => READ_WORDS.has(w))) return "read";
  // Anything else is treated as an external effect — the safer default.
  return "external_effect";
}

/**
 * One segment of a capability id, with anything that could be mistaken for the separator (or
 * for a path) escaped. Server ids and tool names both routinely contain dots, and plain
 * concatenation made server "a.b" tool "c" and server "a" tool "b.c" the same capability —
 * two different tools, one id, one quietly shadowing the other in the registry along with its
 * risk. Ordinary names pass through unchanged.
 */
export function idSegment(part: string): string {
  return String(part).replace(/[^A-Za-z0-9_-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/**
 * The permission a server's tools need before they may run on their own. The runtime is handed
 * these for the servers someone has actually allowed, so the name is built here rather than
 * spelled out on both sides and left to drift apart. It escapes the same way an id does, so two
 * servers cannot end up sharing one permission between them.
 */
export function mcpPermission(serverId: string): string {
  return `mcp:${idSegment(serverId)}`;
}

/** How many tools one server may contribute. Far past any real server; a bound all the same. */
export const MAX_TOOLS_PER_SERVER = 200;

/**
 * How long a name and a description a server may hand us.
 *
 * Both come out of somebody else's process, both end up on a manifest that is kept in the
 * registry and shown to whoever is asked to approve the capability, and neither had a bound —
 * while the failure message beside them is held to 600 characters for exactly that reason. A
 * description is prose, so it is cut; a name is an identity the capability id is built from, so
 * cutting it would let two long names collide into one capability, and a server that writes one
 * past this length contributes that tool and nothing else. Both are far past any real server.
 */
export const MAX_TOOL_NAME = 256;
export const MAX_TOOL_DESCRIPTION = 600;

/** True when a descriptor is something we can actually build a capability from. */
function isUsableTool(tool: unknown): tool is McpToolDescriptor {
  if (!tool || typeof tool !== "object") return false;
  const name = (tool as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 && name.length <= MAX_TOOL_NAME;
}

/** Prose from somebody else's process, cut to a length an operator reads. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Wrap a single MCP tool as a Capability. MCP specifics stay out of the core runtime. */
export function mcpToolToCapability(
  tool: McpToolDescriptor,
  client: McpClient,
  opts: McpAdapterOptions = {},
): Capability {
  // The descriptor is somebody else's self-description: its name is cut to the bound rather than
  // trusted at whatever length it arrived at (discovery refuses one past it outright), and a
  // description that is not prose is no description at all. The result goes through the schema
  // instead of being asserted into shape, so what reaches the registry is what the registry's own
  // vocabulary says a manifest is.
  const name = clamp(tool.name, MAX_TOOL_NAME);
  const described = typeof tool.description === "string" ? clamp(tool.description, MAX_TOOL_DESCRIPTION) : undefined;
  const manifest = CapabilityManifest.parse({
    id: `mcp.${idSegment(client.serverId)}.${idSegment(name)}`,
    name,
    description: described ?? `MCP tool ${name} from ${client.serverId}`,
    tags: ["mcp", client.serverId],
    risk: inferRisk(tool, opts),
    latencyClass: "slow",
    costClass: "medium",
    requiredPermissions: [mcpPermission(client.serverId)],
  });
  return {
    manifest,
    async execute(input: unknown, _ctx: CapabilityContext) {
      try {
        const output = await client.callTool(tool.name, input ?? {});
        return { ok: true, output };
      } catch (err) {
        // somebody else's process: it may throw anything at all, and a failure with no reason
        // tells the operator nothing
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message || "the MCP server failed without saying why" };
      }
    },
  };
}

/** Discover all tools from an MCP client and normalise them into capabilities. */
export async function discoverMcpCapabilities(
  client: McpClient,
  opts: McpAdapterOptions = {},
): Promise<Capability[]> {
  // An MCP server is somebody else's process. Keeping its specifics out of the core includes
  // keeping its failures out: a server that cannot be reached, answers with something that is
  // not a list, or describes a tool without a name contributes nothing rather than taking the
  // whole discovery down.
  let tools: unknown;
  try {
    tools = await client.listTools();
  } catch {
    return [];
  }
  if (!Array.isArray(tools)) return [];
  return tools
    .filter(isUsableTool)
    .slice(0, MAX_TOOLS_PER_SERVER)
    .map((t) => mcpToolToCapability(t, client, opts));
}
