import { describe, it, expect } from "vitest";
import { mcpPermission, mcpToolToCapability, idSegment } from "./index";

/**
 * A server's tools may not run on their own until someone has allowed that server. The name of
 * that allowance is built here and nowhere else: the runtime is handed the same string when a
 * server is wired in, and a permission spelled one way on the manifest and another way in the
 * grant would be a permission that can never be satisfied.
 */
const client = (serverId: string) => ({ serverId, async listTools() { return []; }, async callTool() { return {}; } });

describe("the permission a server's tools need", () => {
  it("is what every tool of that server declares", () => {
    const cap = mcpToolToCapability({ name: "get_weather" }, client("weather"));
    expect(cap.manifest.requiredPermissions).toEqual([mcpPermission("weather")]);
  });

  it("is the same for every tool of the same server", () => {
    const declared = ["get_weather", "set_alert", "delete_city"].map(
      (name) => mcpToolToCapability({ name }, client("weather")).manifest.requiredPermissions[0],
    );
    expect(new Set(declared).size).toBe(1);
  });

  it("is different for every server", () => {
    const names = ["weather", "files", "shell"].map((id) => mcpPermission(id));
    expect(new Set(names).size).toBe(3);
  });

  it("cannot be made to name another server", () => {
    // ids routinely carry dots and colons; allowing one server to compose the name of another
    // would let a server borrow an allowance it was never given
    expect(mcpPermission("a:b")).not.toBe(`${mcpPermission("a")}:b`);
    expect(mcpPermission("a.b")).not.toBe(`${mcpPermission("a")}.b`);
    expect(new Set(["a:b", "a.b", "a b", "a"].map(mcpPermission)).size).toBe(4);
  });

  it("is escaped the same way the capability id is", () => {
    for (const serverId of ["weather", "a:b", "a.b", "üñî"]) {
      expect(mcpPermission(serverId), serverId).toBe(`mcp:${idSegment(serverId)}`);
      expect(mcpToolToCapability({ name: "t" }, client(serverId)).manifest.id, serverId).toContain(idSegment(serverId));
    }
  });

  it("is one string, always, whatever the server calls itself", () => {
    for (const serverId of ["", "a".repeat(300), "  ", "__proto__"]) {
      const declared = mcpToolToCapability({ name: "t" }, client(serverId)).manifest.requiredPermissions;
      expect(declared.length, serverId).toBe(1);
      expect(typeof declared[0], serverId).toBe("string");
      expect(declared[0]!.startsWith("mcp:"), serverId).toBe(true);
    }
  });
});
