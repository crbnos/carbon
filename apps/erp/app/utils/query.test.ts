import { describe, expect, it, vi } from "vitest";

// @carbon/auth's barrel export pulls in @carbon/glossary, whose Lingui `msg`
// macro isn't transformed under plain vitest (no lingui plugin configured for
// apps/erp tests). Mock it the same way traceability.search.test.ts does -
// getSearchTokens/setSearchFilter don't call badRequest or
// parseNumberFromUrlParam, so the mock only needs to satisfy the import.
vi.mock("@carbon/auth", () => ({
  badRequest: vi.fn(),
  parseNumberFromUrlParam: vi.fn()
}));

const { getSearchTokens, setSearchFilter } = await import("./query");

describe("getSearchTokens", () => {
  it("splits a multi-word search into tokens", () => {
    expect(getSearchTokens("M8 Washer")).toEqual(["M8", "Washer"]);
  });

  it("trims and collapses surrounding and repeated whitespace", () => {
    expect(getSearchTokens("  M8   Washer  ")).toEqual(["M8", "Washer"]);
  });

  it("strips PostgREST-structural characters instead of splitting on them", () => {
    expect(getSearchTokens("Washer, Flat (M8)")).toEqual([
      "Washer",
      "Flat",
      "M8"
    ]);
  });

  it("returns an empty array for a single word", () => {
    expect(getSearchTokens("M8")).toEqual(["M8"]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(getSearchTokens("   ")).toEqual([]);
  });
});

describe("setSearchFilter", () => {
  const columns = ["name", "readableIdWithRevision"];

  it("emits one ANDed .or() clause per token, in token order", () => {
    const query = createQueryStub();

    setSearchFilter(query, "M8 Washer", columns);

    expect(query.or).toHaveBeenNthCalledWith(
      1,
      "name.ilike.%M8%,readableIdWithRevision.ilike.%M8%"
    );
    expect(query.or).toHaveBeenNthCalledWith(
      2,
      "name.ilike.%Washer%,readableIdWithRevision.ilike.%Washer%"
    );
    expect(query.or).toHaveBeenCalledTimes(2);
  });

  it("matches today's single-word behavior exactly", () => {
    const query = createQueryStub();

    setSearchFilter(query, "M8", columns);

    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      "name.ilike.%M8%,readableIdWithRevision.ilike.%M8%"
    );
  });

  it("does not filter on null, empty, or whitespace-only search", () => {
    for (const search of [null, "", "   "]) {
      const query = createQueryStub();

      const result = setSearchFilter(query, search, columns);

      expect(query.or).not.toHaveBeenCalled();
      expect(result).toBe(query);
    }
  });
});

function createQueryStub() {
  return {
    or: vi.fn(function (this: unknown) {
      return this;
    })
  };
}
