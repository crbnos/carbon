import { describe, expect, it } from "vitest";
import { isPathOwnedByCompanies } from "./storage-auth";

describe("isPathOwnedByCompanies", () => {
  it("authorizes path when companyId is the prefix segment", () => {
    expect(
      isPathOwnedByCompanies("companyA/parts/test.png", ["companyA"])
    ).toBe(true);
    expect(
      isPathOwnedByCompanies("companyB/parts/test.png", [
        "companyA",
        "companyB"
      ])
    ).toBe(true);
  });

  it("authorizes path when companyId is a slash-bounded inner segment", () => {
    expect(
      isPathOwnedByCompanies("export/companyA/records/test.pdf", ["companyA"])
    ).toBe(true);
  });

  it("rejects path when companyId is not in the allowed list", () => {
    expect(
      isPathOwnedByCompanies("companyC/parts/test.png", [
        "companyA",
        "companyB"
      ])
    ).toBe(false);
  });

  it("rejects partial substring matches (loose substring security check)", () => {
    // If user belongs to 'companyA', 'companyA_extra/file.png' or 'notcompanyA/file.png' must be rejected
    expect(
      isPathOwnedByCompanies("companyA_extra/parts/test.png", ["companyA"])
    ).toBe(false);
    expect(
      isPathOwnedByCompanies("prefix/companyA_extra/test.png", ["companyA"])
    ).toBe(false);
    // Filename containing companyId as substring
    expect(
      isPathOwnedByCompanies("companyC/parts/some_companyA.png", ["companyA"])
    ).toBe(false);
  });

  it("handles empty company list or empty strings gracefully", () => {
    expect(isPathOwnedByCompanies("companyA/parts/test.png", [])).toBe(false);
    expect(isPathOwnedByCompanies("companyA/parts/test.png", [""])).toBe(false);
  });
});
