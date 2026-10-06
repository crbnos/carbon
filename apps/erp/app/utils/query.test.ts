// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// @carbon/auth's barrel export pulls in @carbon/content/glossary, whose Lingui `msg`
// macro isn't transformed under plain vitest (no lingui plugin configured for
// apps/erp tests). Mock it the same way traceability.search.test.ts does -
// getSearchTokens/setSearchFilter don't call badRequest or
// parseNumberFromUrlParam, so the mock only needs to satisfy the import.
vi.mock("@carbon/auth", () => ({
  badRequest: vi.fn(),
  parseNumberFromUrlParam: vi.fn()
}));

const {
  formatRangeFilter,
  getGenericFilter,
  getGenericQueryFilters,
  getSearchTokens,
  parseRangeFilter,
  setSearchFilter
} = await import("./query");

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

describe("between filter", () => {
  it("round-trips a closed range and both open-ended ranges", () => {
    for (const [from, to] of [
      ["2026-10-01", "2026-10-31"],
      ["2026-10-01", null],
      [null, "2026-10-31"]
    ]) {
      const value = formatRangeFilter(from, to);
      expect(value).not.toBeNull();
      expect(parseRangeFilter(value!)).toEqual({ from, to });
    }
  });

  it("has no value when neither bound is set", () => {
    expect(formatRangeFilter(null, undefined)).toBeNull();
  });

  it("survives the URL: an open-ended range still parses as a filter", () => {
    const params = new URLSearchParams();
    params.append(
      "filter",
      `startDate:between:${formatRangeFilter(null, "2026-10-31")}`
    );

    expect(getGenericQueryFilters(params).filters).toEqual([
      { column: "startDate", operator: "between", value: ",2026-10-31" }
    ]);
  });

  it("applies an inclusive bound for each side that is set", () => {
    const both = createQueryStub();
    getGenericFilter(both, "dueDate", "between", "2026-10-01,2026-10-31");
    expect(both.gte).toHaveBeenCalledWith("dueDate", "2026-10-01");
    expect(both.lte).toHaveBeenCalledWith("dueDate", "2026-10-31");

    const fromOnly = createQueryStub();
    getGenericFilter(fromOnly, "dueDate", "between", "2026-10-01,");
    expect(fromOnly.gte).toHaveBeenCalledWith("dueDate", "2026-10-01");
    expect(fromOnly.lte).not.toHaveBeenCalled();

    const toOnly = createQueryStub();
    getGenericFilter(toOnly, "dueDate", "between", ",2026-10-31");
    expect(toOnly.gte).not.toHaveBeenCalled();
    expect(toOnly.lte).toHaveBeenCalledWith("dueDate", "2026-10-31");
  });
});

function createQueryStub() {
  const self = function (this: unknown) {
    return this;
  };
  return {
    or: vi.fn(self),
    gte: vi.fn(self),
    lte: vi.fn(self)
  };
}
