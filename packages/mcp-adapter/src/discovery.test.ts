import { describe, it, expect } from "vitest";
import { discoverMcpCapabilities, mcpToolToCapability, idSegment, MAX_TOOLS_PER_SERVER, type McpClient, type McpToolDescriptor } from "./index";

/**
 * An MCP server is somebody else's process, reached over somebody else's transport. The adapter's
 * job is to keep that out of the core: its tools become capabilities with ids that cannot be
 * confused with another server's, its failures stay inside the adapter, and its risks are read
 * carefully because a mistake there is a capability that runs without asking.
 */
const ctx = { sessionId: "s", now: "2026-09-04T00:00:00Z" };

const client = (over: Partial<McpClient> = {}): McpClient => ({
  serverId: "weather",
  listTools: async () => [{ name: "getForecast" }],
  callTool: async (name, args) => ({ name, args }),
  ...over,
});

describe("a capability id belongs to exactly one tool", () => {
  it("leaves an ordinary name alone", () => {
    expect(mcpToolToCapability({ name: "getForecast" }, client()).manifest.id).toBe("mcp.weather.getForecast");
    expect(idSegment("get_forecast-2")).toBe("get_forecast-2");
  });

  it("does not let two servers arrive at the same id", () => {
    // a dot is ordinary in both a server id and a tool name, and plain concatenation made
    // server "a.b" tool "c" and server "a" tool "b.c" the same capability
    const first = mcpToolToCapability({ name: "c" }, client({ serverId: "a.b" })).manifest.id;
    const second = mcpToolToCapability({ name: "b.c" }, client({ serverId: "a" })).manifest.id;
    expect(first).not.toBe(second);
  });

  it("escapes anything that could be read as a separator or a path", () => {
    expect(idSegment("a.b")).toBe("a%2Eb");
    expect(idSegment("../../escape")).toBe("%2E%2E%2F%2E%2E%2Fescape");
    expect(idSegment("tool with spaces")).toBe("tool%20with%20spaces");
    expect(idSegment("weird/name:here")).toBe("weird%2Fname%3Ahere");
  });

  it("still namespaces by server and asks for that server's permission", () => {
    const cap = mcpToolToCapability({ name: "getForecast", description: "d" }, client());
    expect(cap.manifest.id.startsWith("mcp.weather.")).toBe(true);
    expect(cap.manifest.requiredPermissions).toEqual(["mcp:weather"]);
    expect(cap.manifest.tags).toEqual(["mcp", "weather"]);
    expect(cap.manifest.description).toBe("d");
  });

  it("describes a tool that described itself with nothing", () => {
    const cap = mcpToolToCapability({ name: "x" }, client());
    expect(cap.manifest.description).toContain("weather");
    expect(cap.manifest.latencyClass).toBe("slow");
    expect(cap.manifest.costClass).toBe("medium");
  });
});

describe("a server that misbehaves contributes nothing, and breaks nothing", () => {
  it("survives a server that cannot be reached", async () => {
    expect(await discoverMcpCapabilities(client({ listTools: async () => { throw new Error("stdio pipe closed"); } }))).toEqual([]);
  });

  it("survives a server that answers with something that is not a list", async () => {
    for (const answer of [null, undefined, "tools", 42, { tools: [] }]) {
      expect(await discoverMcpCapabilities(client({ listTools: async () => answer as never })), JSON.stringify(answer)).toEqual([]);
    }
  });

  it("skips a tool it cannot name, and keeps the ones it can", async () => {
    const caps = await discoverMcpCapabilities(client({
      listTools: async () => [{ name: "good" }, { name: "" }, { name: 42 }, null, undefined, { description: "no name" }, { name: "also_good" }] as never,
    }));
    expect(caps.map((c) => c.manifest.name)).toEqual(["good", "also_good"]);
  });

  it("takes only so many tools from one server", async () => {
    const caps = await discoverMcpCapabilities(client({
      listTools: async () => Array.from({ length: MAX_TOOLS_PER_SERVER + 300 }, (_, i) => ({ name: `t${i}` })),
    }));
    expect(caps).toHaveLength(MAX_TOOLS_PER_SERVER);
    expect(caps[0]?.manifest.name).toBe("t0");
  });

  it("returns nothing for a server that offers nothing", async () => {
    expect(await discoverMcpCapabilities(client({ listTools: async () => [] }))).toEqual([]);
  });

  it("gives each discovered tool the risk its own name earns", async () => {
    const caps = await discoverMcpCapabilities(client({
      listTools: async () => [{ name: "list_alerts" }, { name: "delete_history" }, { name: "post_report" }],
    }));
    expect(caps.map((c) => c.manifest.risk)).toEqual(["read", "destructive", "external_effect"]);
  });
});

describe("calling a tool", () => {
  it("passes the input through and hands back what the server said", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client());
    expect(await cap.execute({ city: "Seoul" }, ctx)).toEqual({ ok: true, output: { name: "getForecast", args: { city: "Seoul" } } });
  });

  it("sends an empty object when there is no input", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client());
    expect(await cap.execute(undefined, ctx)).toEqual({ ok: true, output: { name: "getForecast", args: {} } });
  });

  it("turns a failure into an audited result rather than an exception", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client({ callTool: async () => { throw new Error("server gone"); } }));
    expect(await cap.execute({}, ctx)).toEqual({ ok: false, error: "server gone" });
  });

  it("says something even when the server throws something that is not an error", async () => {
    for (const [thrown, expected] of [["a bare string", "a bare string"], [{ code: 500 }, "[object Object]"], [null, "null"]] as [unknown, string][]) {
      const cap = mcpToolToCapability({ name: "x" }, client({ callTool: async () => { throw thrown; } }));
      expect(await cap.execute({}, ctx)).toEqual({ ok: false, error: expected });
    }
  });

  it("does not leave a failure without a reason", async () => {
    const cap = mcpToolToCapability({ name: "x" }, client({ callTool: async () => { throw new Error(""); } }));
    const out = await cap.execute({}, ctx);
    expect(out.ok).toBe(false);
    expect((out.error ?? "").length).toBeGreaterThan(0);
  });

  it("takes whatever shape of output the server returns", async () => {
    for (const output of [null, "text", 42, [1, 2], { nested: { deep: true } }]) {
      const cap = mcpToolToCapability({ name: "x" }, client({ callTool: async () => output }));
      expect(await cap.execute({}, ctx)).toEqual({ ok: true, output });
    }
  });
});
