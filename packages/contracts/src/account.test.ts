import { describe, it, expect } from "vitest";
import {
  ACCOUNT_LINK_KINDS,
  ACCOUNT_LINK_REASONS,
  ACCOUNT_LINK_STATES,
  AccountLink,
  AccountLinkKind,
  AccountLinkReason,
  AccountLinkState,
} from "./index";

/**
 * What a linked AI account may say about itself.
 *
 * The point of the shape is what it cannot carry. A link is described to the person — which
 * service, what kind of link, whether the runtime can use it — and the describing runs over
 * values the person typed into an environment file, so the one thing it must never pick up on
 * the way out is the credential itself. The schema is closed for that reason, not for tidiness.
 */
const link = {
  providerId: "anthropic",
  account: "api.anthropic.com",
  kind: "api_key",
  state: "linked",
  healthy: true,
  reasonCode: "api_key_present",
};

describe("what a linked account may say about itself", () => {
  it("accepts a described link", () => {
    expect(AccountLink.parse(link)).toEqual(link);
  });

  it("refuses a field nobody declared, so a credential cannot ride along", () => {
    for (const smuggled of [
      { apiKey: "sk-secret-value" },
      { cookie: "sessionKey=abc" },
      { password: "hunter2" },
      { token: "sk-ant-123" },
    ]) {
      const result = AccountLink.safeParse({ ...link, ...smuggled });
      expect(result.success, Object.keys(smuggled)[0]).toBe(false);
    }
  });

  it("refuses a kind, state or reason outside the vocabulary", () => {
    expect(AccountLink.safeParse({ ...link, kind: "cookie_jar" }).success).toBe(false);
    expect(AccountLink.safeParse({ ...link, state: "probably_fine" }).success).toBe(false);
    expect(AccountLink.safeParse({ ...link, reasonCode: "because" }).success).toBe(false);
  });

  it("refuses a name long enough to be something other than a name", () => {
    expect(AccountLink.safeParse({ ...link, account: "a".repeat(500) }).success).toBe(false);
    expect(AccountLink.safeParse({ ...link, account: "" }).success).toBe(false);
  });

  it("tells an API key apart from a session the person is already signed into", () => {
    expect([...ACCOUNT_LINK_KINDS]).toEqual(["api_key", "browser_session"]);
    expect(AccountLinkKind.safeParse("browser_session").success).toBe(true);
  });

  it("has a state for a link this runtime cannot act on yet", () => {
    expect([...ACCOUNT_LINK_STATES]).toContain("not_operable");
    expect(AccountLinkState.safeParse("not_operable").success).toBe(true);
    expect(AccountLinkReason.safeParse("session_control_not_built").success).toBe(true);
    expect([...ACCOUNT_LINK_REASONS]).toContain("session_control_not_built");
  });
});
