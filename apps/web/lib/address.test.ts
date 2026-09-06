import { describe, it, expect, afterEach, vi } from "vitest";
import { RuntimeClient, usableToken, sessionHref } from "./runtimeClient";

/**
 * Two outside strings arrive in this page's own address: the session to open, and the token the
 * extension side panel hands it because a page cannot read the extension's storage.
 *
 * The name was spliced into six URLs raw, while the token beside it on the same line was encoded.
 * A name holding a "#" cut the token off into a fragment, so the body silently stopped being able
 * to authenticate and said nothing about why. One holding a "?" put a second token ahead of the
 * real one, so the socket carried whichever the link author chose. One holding "../" walked the
 * request to a different endpoint than the one the body named — asking /api/health/ui while
 * believing it had asked for a session. An approval id is composed from a session name, so it
 * travels the same way.
 *
 * The token had the opposite problem: put straight into a header value, one that is not a legal
 * header value made fetch itself throw, before any request left and on every call the body makes.
 * A link with a newline in its token did not fail to authenticate — it stopped the body asking
 * anything at all.
 */
const NL = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

const NAMES = ["session-local", "s#x", "s?token=stolen", "a/../../health", "my session", "s&connect=1", "100%"];

describe("a session name placed into a URL, not spliced into it", () => {
  it("comes back out of the socket address as the name that went in", () => {
    for (const name of NAMES) {
      const url = new URL(new RuntimeClient(name).wsUrl);
      const inPath = decodeURIComponent(url.pathname.replace("/ws/sessions/", ""));
      expect(inPath, name).toBe(name);
    }
  });

  it("cannot end the path, open a query, or add a second token", () => {
    for (const name of NAMES) {
      const url = new URL(new RuntimeClient(name).wsUrl);
      // one path segment after /ws/sessions/, whatever the name held
      expect(url.pathname.split("/").length, name).toBe(4);
      expect(url.hash, name).toBe("");
      // at most the one token this page is actually using
      expect(url.searchParams.getAll("token").length, name).toBeLessThan(2);
    }
  });

  it("reaches the endpoint the body named, in every call that carries a name", async () => {
    const seen: string[] = [];
    const stub = vi.fn(async (input: unknown) => {
      seen.push(String(input));
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", stub);
    const client = new RuntimeClient("a/../../health", "http://runtime.test");
    await client.emitSim("error_burst");
    await client.undo();
    await client.redo();
    await client.getUI();
    await client.approve("appr-a/../../health-d1-c1");
    await client.reject("appr-a/../../health-d1-c1");
    expect(seen.length).toBe(6);
    for (const url of seen) {
      // the name is spelled out in the path rather than acting on it
      expect(url, url).not.toContain("/../");
      expect(new URL(url).origin).toBe("http://runtime.test");
    }
    // and the intended routes are the ones asked for
    expect(seen.some((u) => u.includes("/api/sim/"))).toBe(true);
    expect(seen.some((u) => u.includes("/api/morph/") && u.endsWith("/undo"))).toBe(true);
    expect(seen.some((u) => u.includes("/api/sessions/") && u.endsWith("/ui"))).toBe(true);
    expect(seen.filter((u) => u.includes("/api/approvals/")).length).toBe(2);
  });

  it("leaves the link the rail builds alone, which was already placed rather than spliced", () => {
    const href = sessionHref("s?token=stolen", "real-token");
    const url = new URL(href, "http://body.test");
    expect(url.searchParams.get("session")).toBe("s?token=stolen");
    expect(url.searchParams.getAll("token")).toEqual(["real-token"]);
  });
});

describe("a token that can be sent as one", () => {
  it("is the token, when it is one", () => {
    expect(usableToken("secret-token")).toBe("secret-token");
    // a token pasted out of a terminal brings its spaces with it
    expect(usableToken("  secret-token  ")).toBe("secret-token");
  });

  it("is nothing at all when it could not be a header value", () => {
    for (const bad of ["abc" + NL + "x-particle-token: forged", "abc" + NUL, "abc" + DEL, "a" + String.fromCharCode(13) + "b"]) {
      expect(usableToken(bad)).toBe("");
    }
  });

  it("is nothing when there is nothing", () => {
    for (const empty of ["", "   ", null, undefined, 7, {}]) {
      expect(usableToken(empty)).toBe("");
    }
  });

  it("is a value fetch will actually accept", () => {
    // the point of the whole thing: no call the body makes dies before it is sent. Building the
    // headers is the same step fetch takes, and what matters is that it comes back with a value.
    for (const raw of ["secret-token", "abc" + NL + "forged", "abc" + NUL, "  spaced  ", ""]) {
      const token = usableToken(raw);
      const headers = new Headers(token ? { "x-particle-token": token } : {});
      expect(headers.get("x-particle-token"), String(raw)).toBe(token === "" ? null : token);
    }
  });

  it("keeps a long token rather than cutting it, because a cut secret is a wrong secret", () => {
    const long = "t".repeat(4_000);
    expect(usableToken(long)).toBe(long);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
