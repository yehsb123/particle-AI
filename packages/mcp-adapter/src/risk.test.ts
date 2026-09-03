import { describe, it, expect } from "vitest";
import type { RiskLevel } from "@particle/contracts";
import { inferRisk, nameWords, mcpToolToCapability, discoverMcpCapabilities, type McpClient, type McpToolDescriptor } from "./index";

/**
 * An MCP server hands us tools we know nothing about, and the risk we assign decides whether one
 * of them can run without asking. Getting this wrong in the read direction is the dangerous
 * mistake, so the name has to be read carefully — word by word, not by substring.
 */
const risk = (name: string, annotations?: McpToolDescriptor["annotations"]): RiskLevel => inferRisk({ name, annotations });

describe("nameWords — delimiters and camelCase humps both split", () => {
  it("finds the verb wherever a server put it", () => {
    expect(nameWords("getWeather")).toEqual(["get", "weather"]);
    expect(nameWords("get_weather")).toEqual(["get", "weather"]);
    expect(nameWords("GET_ALL")).toEqual(["get", "all"]);
    expect(nameWords("x.get.y")).toEqual(["x", "get", "y"]);
    expect(nameWords("read-file")).toEqual(["read", "file"]);
    expect(nameWords("fetchAndDelete")).toEqual(["fetch", "and", "delete"]);
    expect(nameWords("listS3Objects")).toEqual(["list", "s3", "objects"]);
  });

  it("leaves a word that merely starts with a verb alone", () => {
    expect(nameWords("getter")).toEqual(["getter"]);
    expect(nameWords("listen")).toEqual(["listen"]);
    expect(nameWords("readme")).toEqual(["readme"]);
  });

  it("survives punctuation-only and empty names", () => {
    expect(nameWords("")).toEqual([]);
    expect(nameWords("___")).toEqual([]);
  });
});

describe("inferRisk — a read verb is not enough on its own", () => {
  it("calls a plain getter read, in any naming style", () => {
    for (const n of ["getWeather", "get_weather", "GET_ALL", "x.get.y", "list_resources", "read-file", "searchDocs", "query_db", "describe_table", "inspect", "budget_get"]) {
      expect(risk(n), n).toBe("read");
    }
  });

  it("refuses to call a word that merely begins with a verb a read", () => {
    // this is what the old substring matching got wrong
    for (const n of ["getter", "listen", "readme", "searching_party"]) {
      expect(risk(n), n).not.toBe("read");
    }
  });

  it("never lets a read verb make a mutating tool auto-runnable", () => {
    for (const n of ["write_file", "update_row", "sendEmail", "exec", "run_shell", "reset", "get_and_update_row", "fetchAndPost"]) {
      expect(risk(n), n).toBe("external_effect");
    }
  });

  it("treats an unmistakably destructive name as destructive, which never auto-runs", () => {
    for (const n of ["delete_everything", "drop_table", "wipe_disk", "purge_cache", "truncate_table", "searchAndDestroy", "fetch_and_delete_logs", "eraseAll"]) {
      expect(risk(n), n).toBe("destructive");
    }
  });

  it("stays with the safer default for a name that says nothing", () => {
    for (const n of ["aggregate", "targets", "thing", "tool7", ""]) {
      expect(risk(n), n).toBe("external_effect");
    }
  });
});

describe("inferRisk — who gets the last word", () => {
  it("honours a server's read-only hint for an otherwise unreadable name", () => {
    expect(risk("aggregate", { readOnlyHint: true })).toBe("read");
  });

  it("does not believe a read-only hint on a destructive name", () => {
    // a server calling delete_all read-only is wrong or lying, and believing it costs data
    expect(risk("delete_all", { readOnlyHint: true })).toBe("destructive");
  });

  it("takes a destructive hint even when the name looks harmless", () => {
    expect(risk("getThing", { destructiveHint: true })).toBe("destructive");
  });

  it("lets the caller's own override win over hints and names alike", () => {
    expect(inferRisk({ name: "delete_all", annotations: { destructiveHint: true } }, { riskFor: () => "safe_write" })).toBe("safe_write");
    expect(inferRisk({ name: "getX" }, { riskFor: () => undefined })).toBe("read"); // an override that declines falls through
  });
});

describe("mcpToolToCapability — MCP stays out of the core", () => {
  const client = (over: Partial<McpClient> = {}): McpClient => ({
    serverId: "weather",
    listTools: async () => [{ name: "getForecast" }, { name: "delete_history" }],
    callTool: async (name, args) => ({ echoed: { name, args } }),
    ...over,
  });

  it("namespaces the id, carries the risk, and requires a per-server permission", () => {
    const cap = mcpToolToCapability({ name: "getForecast", description: "d" }, client());
    expect(cap.manifest.id).toBe("mcp.weather.getForecast");
    expect(cap.manifest.risk).toBe("read");
    expect(cap.manifest.requiredPermissions).toEqual(["mcp:weather"]);
    expect(cap.manifest.tags).toContain("mcp");
    expect(cap.manifest.tags).toContain("weather");
  });

  it("passes input through and returns the tool's output", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client());
    const out = await cap.execute({ city: "Seoul" }, { sessionId: "s", now: "2026-09-03T00:00:00Z" });
    expect(out).toEqual({ ok: true, output: { echoed: { name: "getForecast", args: { city: "Seoul" } } } });
  });

  it("sends an empty object when a call has no input", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client());
    const out = await cap.execute(undefined, { sessionId: "s", now: "2026-09-03T00:00:00Z" });
    expect(JSON.stringify(out)).toContain('"args":{}');
  });

  it("turns a failing tool call into an audited failure, not an exception", async () => {
    const cap = mcpToolToCapability({ name: "getForecast" }, client({ callTool: async () => { throw new Error("server gone"); } }));
    expect(await cap.execute({}, { sessionId: "s", now: "2026-09-03T00:00:00Z" })).toEqual({ ok: false, error: "server gone" });
  });

  it("discovers every tool with its own risk", async () => {
    const caps = await discoverMcpCapabilities(client());
    expect(caps.map((c) => c.manifest.id)).toEqual(["mcp.weather.getForecast", "mcp.weather.delete_history"]);
    expect(caps.map((c) => c.manifest.risk)).toEqual(["read", "destructive"]);
  });

  it("returns nothing when a server offers nothing", async () => {
    expect(await discoverMcpCapabilities(client({ listTools: async () => [] }))).toEqual([]);
  });
});
