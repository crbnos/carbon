// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { encodeCursor } from "./cursor";
import {
  formatRangeFilter,
  getEffectiveSorts,
  getGenericFilter,
  getGenericQueryFilters,
  getSearchTokens,
  LIST_COUNT,
  listCount,
  parseRangeFilter,
  setGenericQueryFilters,
  setSearchFilter
} from "./query";

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

  it("returns a single word as one token", () => {
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
      'name.ilike."%M8%",readableIdWithRevision.ilike."%M8%"'
    );
    expect(query.or).toHaveBeenNthCalledWith(
      2,
      'name.ilike."%Washer%",readableIdWithRevision.ilike."%Washer%"'
    );
    expect(query.or).toHaveBeenCalledTimes(2);
  });

  it("matches today's single-word behavior exactly", () => {
    const query = createQueryStub();

    setSearchFilter(query, "M8", columns);

    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      'name.ilike."%M8%",readableIdWithRevision.ilike."%M8%"'
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

describe("cursor paging params", () => {
  it("reads the cursor from ?after= and fixes the page size", () => {
    const cursor = { values: ["Bolt"], id: "it_1", keys: ["name:asc"] };
    const params = new URLSearchParams({ after: encodeCursor(cursor) });
    // ?limit= and ?offset= from old bookmarks are ignored.
    params.set("limit", "1000");
    params.set("offset", "500");

    expect(getGenericQueryFilters(params)).toMatchObject({
      limit: 100,
      cursor
    });
  });

  it("starts from the first page without ?after= or with a bad token", () => {
    expect(getGenericQueryFilters(new URLSearchParams()).cursor).toBeNull();
    expect(
      getGenericQueryFilters(new URLSearchParams({ after: "garbage" })).cursor
    ).toBeNull();
  });

  it("reads the Table's count request from ?count=exact, without a cursor", () => {
    const cursor = { values: ["Bolt"], id: "it_1", keys: ["name:asc"] };
    const params = new URLSearchParams({
      after: encodeCursor(cursor),
      count: "exact"
    });
    expect(getGenericQueryFilters(params)).toMatchObject({
      cursor: null,
      exactCount: true
    });
    expect(getGenericQueryFilters(new URLSearchParams())).not.toHaveProperty(
      "exactCount"
    );
  });
});

describe("listCount", () => {
  it("counts page 1 with LIST_COUNT, a later page not at all", () => {
    expect(listCount({ cursor: null })).toBe(LIST_COUNT);
    expect(listCount(undefined)).toBe(LIST_COUNT);
    expect(
      listCount({ cursor: { values: [], id: "a", keys: [] } })
    ).toBeUndefined();
  });

  it("counts exactly for the count request", () => {
    expect(listCount({ cursor: null, exactCount: true })).toBe("exact");
  });
});

describe("getEffectiveSorts", () => {
  const defaults = [
    { column: "createdAt", ascending: false },
    { column: "name", ascending: true, foreignTable: "customer" }
  ];

  it("uses the defaults, minus foreign-table sorts, when the user has none", () => {
    expect(getEffectiveSorts({ sorts: [] }, defaults)).toEqual([
      { column: "createdAt", ascending: false }
    ]);
  });

  it("uses the user's sorts and drops a sort on another table's column", () => {
    expect(
      getEffectiveSorts(
        {
          sorts: [
            { sortBy: "customer.name", sortAsc: true },
            { sortBy: "dueDate", sortAsc: true }
          ]
        },
        defaults
      )
    ).toEqual([{ column: "dueDate", ascending: true }]);
  });

  it("falls back to the defaults when every user sort is dropped", () => {
    expect(
      getEffectiveSorts(
        { sorts: [{ sortBy: "customer.name", sortAsc: true }] },
        defaults
      )
    ).toEqual([{ column: "createdAt", ascending: false }]);
  });
});

describe("setGenericQueryFilters paging", () => {
  const sorts = [{ column: "createdAt", ascending: false }];

  it("asks for one extra row in cursor mode (list loaders)", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 100, cursor: null }, sorts);
    expect(query.limit).toHaveBeenCalledWith(101);
    expect(query.range).not.toHaveBeenCalled();
  });

  it("asks for one row for the count request", () => {
    const query = createQueryStub();
    setGenericQueryFilters(
      query as never,
      { limit: 100, cursor: null, exactCount: true },
      sorts
    );
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("keeps exact offset paging when no cursor is given (MCP, v1 API)", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 50, offset: 100 }, sorts);
    expect(query.range).toHaveBeenCalledWith(100, 149);
    expect(query.limit).not.toHaveBeenCalled();
  });

  it("pages by offset when the cursor key is present but undefined", () => {
    const query = createQueryStub();
    setGenericQueryFilters(
      query as never,
      { limit: 50, offset: 100, cursor: undefined },
      sorts
    );
    expect(query.range).toHaveBeenCalledWith(100, 149);
    expect(query.limit).not.toHaveBeenCalled();
  });

  it("filters after a cursor cut for the same order", () => {
    const query = createQueryStub();
    setGenericQueryFilters(
      query as never,
      {
        limit: 100,
        cursor: { values: ["2026-10-13"], id: "so_1", keys: ["createdAt:desc"] }
      },
      { defaultSorts: sorts }
    );
    expect(query.or).toHaveBeenCalledWith(
      'createdAt.lt."2026-10-13",and(createdAt.eq."2026-10-13",id.gt."so_1")'
    );
  });

  it("returns no rows for a cursor cut for another order", () => {
    const query = createQueryStub();
    setGenericQueryFilters(
      query as never,
      {
        limit: 100,
        cursor: { values: ["Bolt"], id: "it_1", keys: ["name:asc"] }
      },
      { defaultSorts: sorts, idColumn: "itemId" }
    );
    expect(query.or).toHaveBeenCalledWith(
      "and(itemId.is.null,itemId.not.is.null)"
    );
    expect(query.limit).toHaveBeenCalledWith(101);
  });

  it("breaks ties by the id after the list's order", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 100, cursor: null }, sorts);
    expect(query.order.mock.calls).toEqual([
      ["createdAt", { ascending: false, foreignTable: undefined }],
      ["id", { ascending: true }]
    ]);
  });

  it("breaks ties by the list's own id column", () => {
    const query = createQueryStub();
    setGenericQueryFilters(
      query as never,
      { sorts: [{ sortBy: "name", sortAsc: true }], limit: 50, offset: 0 },
      { defaultSorts: sorts, idColumn: "itemId" }
    );
    expect(query.order.mock.calls).toEqual([
      ["name", { ascending: true, foreignTable: undefined }],
      ["itemId", { ascending: true }]
    ]);
  });

  it("adds no second id order when the order already ends with the id", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 100, cursor: null }, [
      { column: "id", ascending: false }
    ]);
    expect(query.order.mock.calls).toEqual([
      ["id", { ascending: false, foreignTable: undefined }]
    ]);
  });

  it("orders by the id alone when a cursor list has no sorts", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 100, cursor: null });
    expect(query.order.mock.calls).toEqual([["id", { ascending: true }]]);
  });

  it("leaves a query nothing orders in its own order (an RPC's ORDER BY)", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, { limit: 1000, offset: 0 });
    expect(query.order).not.toHaveBeenCalled();
    expect(query.range).toHaveBeenCalledWith(0, 999);
  });

  it("does not page at all without a limit", () => {
    const query = createQueryStub();
    setGenericQueryFilters(query as never, {}, sorts);
    expect(query.range).not.toHaveBeenCalled();
    expect(query.limit).not.toHaveBeenCalled();
  });
});

function createQueryStub() {
  const self = function (this: unknown) {
    return this;
  };
  return {
    or: vi.fn(self),
    gte: vi.fn(self),
    lte: vi.fn(self),
    order: vi.fn(self),
    limit: vi.fn(self),
    range: vi.fn(self)
  };
}
