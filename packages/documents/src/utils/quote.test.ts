import { describe, expect, it } from "vitest";
import { getQuoteDisplayId } from "./quote";

describe("getQuoteDisplayId", () => {
  it("returns the bare id for the original quote (revision 0)", () => {
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: 0 })).toBe(
      "Q000001"
    );
  });

  it("treats a null revision as the original", () => {
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: null })).toBe(
      "Q000001"
    );
  });

  it("suffixes the revision for a revised quote", () => {
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: 1 })).toBe(
      "Q000001-1"
    );
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: 12 })).toBe(
      "Q000001-12"
    );
  });

  it("returns an empty string when the id is missing, even with a revision", () => {
    expect(getQuoteDisplayId({ quoteId: null, revisionId: 0 })).toBe("");
    expect(getQuoteDisplayId({ quoteId: null, revisionId: 2 })).toBe("");
  });
});
