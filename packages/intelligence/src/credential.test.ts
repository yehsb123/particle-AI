import { describe, it, expect } from "vitest";
import { AnthropicProvider, anthropicRequest, authHeaders, credentialFromEnv } from "./anthropic";

/**
 * Two ways to be allowed to ask: a key somebody pasted, or a login somebody did.
 *
 * They go to the same endpoint and are rejected by it in different ways. A key rides in
 * `x-api-key`; an access token rides in `Authorization` and is ignored unless the request also
 * carries the beta flag that opts it into OAuth, so a token sent the way a key is sent comes back
 * as an authentication failure and looks like a bad token rather than a missing header.
 */
describe("which credential the environment is carrying", () => {
  it("takes the key over the login, because exporting a key says which one was meant", () => {
    const both = credentialFromEnv({ ANTHROPIC_API_KEY: "sk-key", ANTHROPIC_AUTH_TOKEN: "tok" });
    expect(both).toEqual({ kind: "api_key", value: "sk-key" });
  });

  it("falls to the login when no key was exported", () => {
    expect(credentialFromEnv({ ANTHROPIC_AUTH_TOKEN: "tok" })).toEqual({ kind: "oauth", value: "tok" });
  });

  it("reads an empty or blank value as nothing at all", () => {
    // an empty key still wins its precedence slot in the tooling and authenticates as empty
    expect(credentialFromEnv({ ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "tok" })).toEqual({ kind: "oauth", value: "tok" });
    expect(credentialFromEnv({ ANTHROPIC_API_KEY: "   " })).toBeNull();
    expect(credentialFromEnv({})).toBeNull();
  });
});

describe("how each credential is spelled on the wire", () => {
  it("sends a key as a key, and nothing else", () => {
    const headers = authHeaders({ kind: "api_key", value: "sk-key" });
    expect(headers["x-api-key"]).toBe("sk-key");
    expect(headers.authorization).toBeUndefined();
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends a login as a bearer token, with the beta that makes it readable", () => {
    const headers = authHeaders({ kind: "oauth", value: "tok" });
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    // a token in the key header is refused and reads as a bad token rather than a wrong header
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("carries that through to the request the provider actually builds", () => {
    const { headers } = anthropicRequest({
      credential: { kind: "oauth", value: "tok" },
      model: "m",
      maxTokens: 10,
      content: "hi",
    });
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(headers["anthropic-version"]).toBeTruthy();
  });
});

describe("a provider handed only a login", () => {
  it("reports itself usable", async () => {
    expect((await new AnthropicProvider({ authToken: "tok" }).health()).healthy).toBe(true);
  });

  it("says both ways in when it has neither", async () => {
    // the constructor falls back to the real environment, which on a machine with a key exported
    // would make this pass for the wrong reason
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const bare = await new AnthropicProvider({}).health();
      expect(bare.healthy).toBe(false);
      expect(bare.detail).toContain("ANTHROPIC_API_KEY");
      expect(bare.detail).toContain("ANTHROPIC_AUTH_TOKEN");
    } finally {
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});
