import { describe, it, expect } from "vitest";
import { discoverMcpCapabilities, inferRisk, mcpToolToCapability, type McpClient, type McpToolDescriptor } from "./index";
import { CapabilityRegistry, CapabilityExecutor } from "@dm/capability-core";

class FakeMcpClient implements McpClient {
  readonly serverId = "files";
  calls: { name: string; args: unknown }[] = [];
  constructor(private tools: McpToolDescriptor[]) {}
  async listTools() {
    return this.tools;
  }
  async callTool(name: string, args: unknown) {
    this.calls.push({ name, args });
    return { echoed: args, tool: name };
  }
}

const tools: McpToolDescriptor[] = [
  { name: "read_file", description: "Read a file" },
  { name: "write_file", description: "Write a file" },
  { name: "delete_path", annotations: { destructiveHint: true } },
  { name: "list_dir", annotations: { readOnlyHint: true } },
];

describe("inferRisk", () => {
  it("uses name heuristics and annotations", () => {
    expect(inferRisk(tools[0]!)).toBe("read"); // read_file
    expect(inferRisk(tools[1]!)).toBe("external_effect"); // write_file (unknown → external)
    expect(inferRisk(tools[2]!)).toBe("destructive"); // annotation
    expect(inferRisk(tools[3]!)).toBe("read"); // annotation
  });

  it("honors an explicit override", () => {
    expect(inferRisk(tools[1]!, { riskFor: () => "safe_write" })).toBe("safe_write");
  });
});

describe("mcpToolToCapability", () => {
  it("produces a namespaced capability that calls the tool", async () => {
    const client = new FakeMcpClient(tools);
    const cap = mcpToolToCapability(tools[0]!, client);
    expect(cap.manifest.id).toBe("mcp.files.read_file");
    expect(cap.manifest.tags).toContain("mcp");
    const res = await cap.execute({ path: "a.txt" }, { sessionId: "s", now: "2026-01-01T00:00:00Z" });
    expect(res.ok).toBe(true);
    expect(client.calls[0]).toEqual({ name: "read_file", args: { path: "a.txt" } });
  });
});

describe("discovery integrates with the capability registry", () => {
  it("registers discovered MCP tools as executable capabilities", async () => {
    const client = new FakeMcpClient(tools);
    const caps = await discoverMcpCapabilities(client);
    expect(caps).toHaveLength(4);

    const registry = new CapabilityRegistry();
    registry.registerAll(caps);
    expect(registry.has("mcp.files.read_file")).toBe(true);
    expect(registry.riskOf("mcp.files.delete_path")).toBe("destructive");

    let n = 0;
    const executor = new CapabilityExecutor(registry, () => `2026-01-01T00:00:0${n++}Z`);
    const out = await executor.execute("mcp.files.list_dir", { path: "." }, { sessionId: "s", now: "2026-01-01T00:00:00Z" });
    expect(out.result.ok).toBe(true);
  });
});
