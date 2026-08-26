import { describe, expect, it } from "vitest";
import { getQuoteDisplayId } from "./quote";

// Suffix rules live in revision.test.ts; this pins field mapping only.
describe("getQuoteDisplayId", () => {
  it("reads quoteId and revisionId off the quote", () => {
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: 0 })).toBe(
      "Q000001"
    );
    expect(getQuoteDisplayId({ quoteId: "Q000001", revisionId: 2 })).toBe(
      "Q000001-2"
    );
  });

  it("returns an empty string for a missing quote", () => {
    expect(getQuoteDisplayId(undefined)).toBe("");
    expect(getQuoteDisplayId(null)).toBe("");
  });
});
