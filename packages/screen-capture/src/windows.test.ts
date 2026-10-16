import { describe, it, expect } from "vitest";
import { windowsCaptureBackend } from "./windows";

/**
 * Taking the picture needs Windows, so what this file pins down is the part that has to hold
 * everywhere: the backend answers, rather than throwing or hanging, when it cannot do the thing.
 * A sensor that throws from inside a capture takes its caller down with it, and a backend that
 * reports nothing at all is indistinguishable from one that has not finished.
 */
describe("the Windows backend where Windows is not", () => {
  it("is called windows", () => {
    expect(windowsCaptureBackend().name).toBe("windows");
  });

  it("answers with a refusal naming the platform, rather than starting anything", async () => {
    const backend = windowsCaptureBackend({ platform: "linux" });
    const result = await backend.capture({ target: { kind: "foreground" }, path: "/tmp/a.png" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("linux");
      expect(result.reason.toLowerCase()).toContain("windows");
    }
  });

  it("answers with a refusal when the request itself is not one it can carry out", async () => {
    const backend = windowsCaptureBackend({ platform: "win32" });
    const result = await backend.capture({ target: { kind: "foreground" }, path: "/tmp/a.jpg" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/png/i);
  });
});
