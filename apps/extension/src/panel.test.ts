import { describe, it, expect } from "vitest";
import { probeUrl, bodyUrl } from "./panel";

/**
 * The side panel checks whether the body is up before loading it, and it used to check one
 * address while pointing the frame at another: the probe was hardcoded while the frame's URL
 * comes from the panel's HTML. Anyone running the body on a different port got a panel that
 * said "not reachable" forever, since loading is gated on that check. One address now, derived
 * from the frame.
 */
const REAL = "http://localhost:3000/?connect=1&session=ext";

describe("where to check whether the body is up", () => {
  it("checks the origin of whatever the frame is pointed at", () => {
    expect(probeUrl(REAL)).toBe("http://localhost:3000/");
    expect(probeUrl("http://localhost:3010/?connect=1")).toBe("http://localhost:3010/");
    expect(probeUrl("http://127.0.0.1:3000/?connect=1")).toBe("http://127.0.0.1:3000/");
    expect(probeUrl("https://body.example/x/y?z=1#frag")).toBe("https://body.example/");
  });

  it("falls back to the usual address when the frame says nothing readable", () => {
    for (const src of ["", "not a url", "undefined", "//localhost:3000"]) {
      expect(probeUrl(src), src).toBe("http://localhost:3000/");
    }
  });
});

describe("the URL the body is loaded with", () => {
  it("passes a configured token along, since the body cannot read extension storage", () => {
    expect(bodyUrl(REAL, "s3cret")).toBe(`${REAL}&token=s3cret`);
  });

  it("adds the token with a question mark when there is no query yet", () => {
    expect(bodyUrl("http://localhost:3000/", "t")).toBe("http://localhost:3000/?token=t");
  });

  it("escapes a token that would otherwise change the query", () => {
    expect(bodyUrl(REAL, "a b&c=d")).toBe(`${REAL}&token=a%20b%26c%3Dd`);
    expect(bodyUrl(REAL, "a&session=someone-else")).not.toContain("&session=someone-else");
  });

  it("trims a token before deciding whether there is one", () => {
    expect(bodyUrl(REAL, "  s3cret  ")).toBe(`${REAL}&token=s3cret`);
    expect(bodyUrl(REAL, "   ")).toBe(REAL);
  });

  it("adds nothing when no token is configured", () => {
    for (const token of ["", undefined, null, 42, {}, []]) {
      expect(bodyUrl(REAL, token), JSON.stringify(token)).toBe(REAL);
    }
  });
});
