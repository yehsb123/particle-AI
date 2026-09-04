import { describe, it, expect } from "vitest";
import { APPROVAL_REASONS } from "@particle/contracts";
import { describeApprovalReason, missingPermissionNames } from "./approval";
import { t } from "./i18n";

/**
 * The approval card showed a capability id and a risk badge and then asked the person to decide.
 * It never said what the question was. Each reason the runtime can be waiting for now has words
 * in both languages, and they have to be different words: being asked because a capability is
 * risky and being asked because nobody has allowed its server are different decisions, and only
 * the second is answered by knowing which server it is.
 */
describe("every reason a person can be asked for", () => {
  it("has words in both languages", () => {
    for (const code of APPROVAL_REASONS) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`approval_${code}`, lang), `${lang}:${code}`).not.toBe(`approval_${code}`);
      }
      expect(t(`approval_${code}`, "en"), code).not.toBe(t(`approval_${code}`, "ko"));
    }
  });

  it("reads as a sentence about this capability, not as its own name", () => {
    for (const code of APPROVAL_REASONS) {
      for (const lang of ["en", "ko"] as const) {
        const said = describeApprovalReason({ reasonCode: code }, lang);
        expect(said, `${lang}:${code}`).not.toBe(code);
        expect(said, `${lang}:${code}`).not.toContain("approval_");
        expect(said.length, `${lang}:${code}`).toBeGreaterThan(8);
      }
    }
  });

  it("tells the two of them apart", () => {
    const risky = describeApprovalReason({ reasonCode: "risk_above_autonomy" }, "ko");
    const ungranted = describeApprovalReason({ reasonCode: "permission_not_granted" }, "ko");
    expect(risky).not.toBe(ungranted);
  });
});

describe("a record that does not say why", () => {
  it("falls back to the reason that was the only one there used to be", () => {
    for (const approval of [{}, { reasonCode: undefined }, { reasonCode: "" }]) {
      expect(describeApprovalReason(approval, "en")).toBe(t("approval_risk_above_autonomy", "en"));
    }
  });

  it("still says something for a reason nobody has written words for", () => {
    expect(describeApprovalReason({ reasonCode: "budget_exhausted" }, "en")).toBe("budget exhausted");
    expect(describeApprovalReason({ reasonCode: "budget_exhausted" }, "en")).not.toContain("approval_");
  });

  it("is not confused by a name that belongs to every object", () => {
    for (const code of ["toString", "constructor", "__proto__"]) {
      const said = describeApprovalReason({ reasonCode: code }, "en");
      expect(said, code).not.toContain("approval_");
      expect(typeof said, code).toBe("string");
    }
  });
});

describe("the permissions named on the card", () => {
  it("are the ones the runtime said are missing", () => {
    expect(missingPermissionNames({ missingPermissions: ["mcp:weather"] })).toEqual(["mcp:weather"]);
  });

  it("are none when nothing is missing", () => {
    for (const approval of [{}, { missingPermissions: [] }]) {
      expect(missingPermissionNames(approval)).toEqual([]);
    }
  });

  it("do not repeat, and do not include blanks", () => {
    expect(missingPermissionNames({ missingPermissions: ["mcp:a", "mcp:a", "  ", "", " mcp:b "] })).toEqual(["mcp:a", "mcp:b"]);
  });

  it("survive a record whose names are not names", () => {
    const junk = { missingPermissions: [null, 7, {}, ["mcp:a"]] as unknown as string[] };
    expect(missingPermissionNames(junk)).toEqual([]);
  });
});
