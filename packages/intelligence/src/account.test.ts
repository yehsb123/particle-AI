import { describe, it, expect } from "vitest";
import { AccountLink } from "@particle/contracts";
import {
  BrowserSessionProvider,
  browserSessionsFromEnv,
  buildDefaultProviders,
  describeAccountLinks,
  describeProviders,
} from "./index";

/**
 * A person's AI account can reach this runtime two ways: a key they pasted into the environment,
 * or a session they are already signed into in a browser. Only the first one works. The second
 * is a place that has been made for it, and the rule for a place that is not filled in yet is
 * that it says so — in what it reports, in what it refuses to do, and in what the person reads.
 *
 * The describing is the part that has to be watched. It runs over environment values, so the one
 * thing it must never carry out is the credential; that is the standard `describeProviders`
 * already holds, and this holds it too.
 */
describe("a session the person is already signed into", () => {
  it("is built from the environment, one per host", () => {
    const sessions = browserSessionsFromEnv({ DM_BROWSER_SESSIONS: "claude.ai, chatgpt.com" });
    expect(sessions.map((s) => s.host)).toEqual(["claude.ai", "chatgpt.com"]);
    expect(sessions.map((s) => s.id)).toEqual(["session:claude.ai", "session:chatgpt.com"]);
  });

  it("is nothing at all when nobody declared one", () => {
    expect(browserSessionsFromEnv({})).toEqual([]);
    expect(browserSessionsFromEnv({ DM_BROWSER_SESSIONS: "" })).toEqual([]);
    expect(browserSessionsFromEnv({ DM_BROWSER_SESSIONS: " , ,, " })).toEqual([]);
  });

  it("counts a host named twice once, so one account is not two rows", () => {
    const sessions = browserSessionsFromEnv({ DM_BROWSER_SESSIONS: "claude.ai,claude.ai" });
    expect(sessions.map((s) => s.id)).toEqual(["session:claude.ai"]);
  });

  it("refuses a host that is not a name, rather than showing it to the person", () => {
    expect(() => browserSessionsFromEnv({ DM_BROWSER_SESSIONS: "a".repeat(500) })).toThrow(/DM_BROWSER_SESSIONS/);
  });

  it("says it cannot think, in the two ways the router reads", async () => {
    const session = new BrowserSessionProvider({ host: "claude.ai" });
    expect(session.capabilities).toEqual([]);
    const health = await session.health();
    expect(health).toEqual({ id: "session:claude.ai", healthy: false, detail: expect.any(String) });
  });

  it("refuses to answer rather than inventing one", async () => {
    const session = new BrowserSessionProvider({ host: "claude.ai" });
    await expect(session.evaluate({ purpose: "decide.runtime", capability: "reason.deep" })).rejects.toThrow(
      /session_control_not_built/,
    );
  });
});

describe("what the environment builds", () => {
  it("makes a place for a declared session beside the brains that can think", () => {
    const ids = buildDefaultProviders({ ANTHROPIC_API_KEY: "k", DM_BROWSER_SESSIONS: "claude.ai" }).map((p) => p.id);
    expect(ids).toEqual(["anthropic", "session:claude.ai", "mock"]);
  });

  it("leaves the deterministic brain the last word", () => {
    const ids = buildDefaultProviders({ DM_BROWSER_SESSIONS: "claude.ai" }).map((p) => p.id);
    expect(ids.at(-1)).toBe("mock");
  });

  it("shows a declared session as configured but not usable", async () => {
    const described = await describeProviders({ DM_BROWSER_SESSIONS: "claude.ai" });
    const session = described.find((p) => p.id === "session:claude.ai");
    expect(session?.healthy).toBe(false);
  });
});

describe("what the person is told about their accounts", () => {
  it("lists a key-based account as not linked until a key is there", async () => {
    const links = await describeAccountLinks({});
    expect(links.map((l) => l.providerId)).toEqual(["anthropic", "openai"]);
    for (const l of links) {
      expect(l.kind).toBe("api_key");
      expect(l.state).toBe("not_linked");
      expect(l.healthy).toBe(false);
      expect(l.reasonCode).toBe("credential_absent");
    }
  });

  it("lists a key-based account as linked and alive once a key is there", async () => {
    const links = await describeAccountLinks({ ANTHROPIC_API_KEY: "sk-secret-value" });
    const anthropic = links.find((l) => l.providerId === "anthropic")!;
    expect(anthropic.state).toBe("linked");
    expect(anthropic.healthy).toBe(true);
    expect(anthropic.reasonCode).toBe("api_key_present");
    expect(anthropic.account).toBe("api.anthropic.com");
  });

  it("never reports a credential, only whether one is there", async () => {
    const links = await describeAccountLinks({
      ANTHROPIC_API_KEY: "sk-secret-value",
      OPENAI_API_KEY: "sk-another-secret",
      DM_BROWSER_SESSIONS: "claude.ai",
    });
    const reported = JSON.stringify(links);
    expect(reported).not.toContain("sk-secret");
    expect(reported).not.toContain("sk-another");
    expect(links.every((l) => AccountLink.safeParse(l).success)).toBe(true);
  });

  it("says of a signed-in session that the runtime cannot use it yet", async () => {
    const links = await describeAccountLinks({ DM_BROWSER_SESSIONS: "claude.ai" });
    const session = links.find((l) => l.kind === "browser_session")!;
    expect(session.account).toBe("claude.ai");
    expect(session.providerId).toBe("session:claude.ai");
    expect(session.state).toBe("not_operable");
    expect(session.healthy).toBe(false);
    expect(session.reasonCode).toBe("session_control_not_built");
  });

  it("never calls a declared session linked, however many are declared", async () => {
    const links = await describeAccountLinks({ DM_BROWSER_SESSIONS: "claude.ai,chatgpt.com" });
    const sessions = links.filter((l) => l.kind === "browser_session");
    expect(sessions).toHaveLength(2);
    expect(sessions.every((l) => l.state === "not_operable")).toBe(true);
    expect(sessions.some((l) => l.state === "linked")).toBe(false);
  });
});
