import { describe, expect, it } from "vitest";
import { getQuoteDisplayId } from "./quote";

// The suffix rules themselves are covered once in revision.test.ts — this only
// pins that the quote helper reads the right two fields and tolerates a missing
// quote (call sites pass `routeData?.quote`).
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
