// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearInfiniteRows,
  getCountUrl,
  getInfiniteRows,
  getPageUrl,
  getRefreshPageCount,
  getResetKey,
  getSearchKey,
  getStoreKey,
  type InfiniteRowsEntry,
  MAX_REFRESH_PAGES,
  mergeRows,
  readPage,
  readRowId,
  saveInfiniteRows
} from "./infiniteRowsStore";

const entry = (scrollTop: number, pageCount = 1): InfiniteRowsEntry => ({
  pages: Array.from({ length: pageCount }, (_, page) => ({
    rows: [{ id: `row-${scrollTop}-${page}` }],
    nextCursor: `c${page}`
  })),
  scrollTop
});

const company = "company-a";

describe("infinite rows memory", () => {
  beforeEach(() => clearInfiniteRows());

  it("returns the entry saved for the same key only", () => {
    saveInfiniteRows(company, "/x/sales/orders?sort=name%3Aasc", entry(300));
    expect(getInfiniteRows(company, "/x/sales/orders?sort=name%3Aasc")).toEqual(
      entry(300)
    );
    expect(getInfiniteRows(company, "/x/sales/orders?")).toBeUndefined();
    expect(
      getInfiniteRows(company, "/x/items/parts?sort=name%3Aasc")
    ).toBeUndefined();
  });

  it("keeps 10 entries and drops the oldest save first", () => {
    for (let i = 0; i < 11; i++) {
      saveInfiniteRows(company, `/list/${i}?`, entry(i));
    }
    expect(getInfiniteRows(company, "/list/0?")).toBeUndefined();
    expect(getInfiniteRows(company, "/list/1?")).toEqual(entry(1));
    expect(getInfiniteRows(company, "/list/10?")).toEqual(entry(10));
  });

  it("treats a new save of a key as the newest", () => {
    for (let i = 0; i < 10; i++) {
      saveInfiniteRows(company, `/list/${i}?`, entry(i));
    }
    saveInfiniteRows(company, "/list/0?", entry(99)); // list 0 is now the newest
    saveInfiniteRows(company, "/list/10?", entry(10)); // drops list 1, not list 0
    expect(getInfiniteRows(company, "/list/0?")).toEqual(entry(99));
    expect(getInfiniteRows(company, "/list/1?")).toBeUndefined();
  });

  it("forgets every entry when the company changes", () => {
    saveInfiniteRows(company, "/list?", entry(1));
    expect(getInfiniteRows("company-b", "/list?")).toBeUndefined();
    // Back in the first company, its rows are gone too.
    expect(getInfiniteRows(company, "/list?")).toBeUndefined();
  });

  it("saves at most the pages a revalidation re-reads", () => {
    saveInfiniteRows(company, "/list?", entry(1, 40));
    const saved = getInfiniteRows(company, "/list?");
    expect(saved?.pages).toHaveLength(MAX_REFRESH_PAGES - 1);
    // The cursor continues after the last page kept.
    expect(saved?.pages.at(-1)?.nextCursor).toBe(`c${MAX_REFRESH_PAGES - 2}`);
  });
});

describe("getStoreKey", () => {
  const key = (companyId: string, dataKey: string, pageUrl: string) =>
    getStoreKey({ companyId, dataKey, pageUrl, ignoreParams: ["item"] });

  it("keys by company, rows key and URL", () => {
    const base = key("a", "jobs", "/x/production/jobs?sort=name%3Aasc");
    expect(key("b", "jobs", "/x/production/jobs?sort=name%3Aasc")).not.toBe(
      base
    );
    expect(key("a", "batches", "/x/production/jobs?sort=name%3Aasc")).not.toBe(
      base
    );
    expect(key("a", "jobs", "/x/production/jobs?sort=name%3Adesc")).not.toBe(
      base
    );
  });

  it("ignores `after`, the ignored params and the param order", () => {
    expect(
      key("a", "jobs", "/x/production/jobs?item=i1&after=c&sort=name%3Aasc")
    ).toBe(key("a", "jobs", "/x/production/jobs?sort=name%3Aasc"));
  });
});

describe("getSearchKey", () => {
  it("ignores `after` and the parameter order", () => {
    expect(getSearchKey("?sort=name:asc&after=abc&filter=status:eq:Open")).toBe(
      getSearchKey("?filter=status:eq:Open&sort=name:asc")
    );
  });

  it("changes with a filter, a sort or a search", () => {
    const base = getSearchKey("?sort=name:asc");
    expect(getSearchKey("?sort=name:desc")).not.toBe(base);
    expect(getSearchKey("?sort=name:asc&search=bolt")).not.toBe(base);
  });
});

describe("getResetKey", () => {
  it("stays the same when only an ignored param changes", () => {
    expect(getResetKey("?sort=name:asc&item=i1", undefined, ["item"])).toBe(
      getResetKey("?sort=name:asc", undefined, ["item"])
    );
    expect(getResetKey("?sort=name:desc", undefined, ["item"])).not.toBe(
      getResetKey("?sort=name:asc", undefined, ["item"])
    );
  });

  it("follows the search of a separate page URL", () => {
    expect(getResetKey("", "/api/sync?status=failed")).not.toBe(
      getResetKey("", "/api/sync?status=ok")
    );
    expect(getResetKey("", "/api/sync?status=ok&after=c")).toBe(
      getResetKey("", "/api/sync?status=ok")
    );
  });
});

describe("getPageUrl", () => {
  it("sets `after` on the list route's URL and keeps its search", () => {
    const url = getPageUrl("/x/sales/orders?sort=name%3Aasc&after=old", "new");
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/x/sales/orders");
    expect(parsed.searchParams.get("sort")).toBe("name:asc");
    expect(parsed.searchParams.getAll("after")).toEqual(["new"]);
  });

  it("keeps the naked `index` param of an index route", () => {
    const parsed = new URL(
      getPageUrl("/x/workflows?index&search=a", "c1"),
      "http://localhost"
    );
    expect(parsed.searchParams.getAll("index")).toEqual([""]);
    expect(parsed.searchParams.get("after")).toBe("c1");
  });

  it("works for a URL with no search", () => {
    expect(getPageUrl("/x/items/parts", "c1")).toBe("/x/items/parts?after=c1");
  });
});

describe("getCountUrl", () => {
  it("asks for the exact count in place of a page, with the list's search", () => {
    const parsed = new URL(
      getCountUrl("/x/sales/orders?sort=name%3Aasc&after=old"),
      "http://localhost"
    );
    expect(parsed.pathname).toBe("/x/sales/orders");
    expect(parsed.searchParams.get("sort")).toBe("name:asc");
    expect(parsed.searchParams.has("after")).toBe(false);
    expect(parsed.searchParams.get("count")).toBe("exact");
  });

  it("keeps the naked `index` param of an index route", () => {
    const parsed = new URL(
      getCountUrl("/x/workflows?index&search=a"),
      "http://localhost"
    );
    expect(parsed.searchParams.getAll("index")).toEqual([""]);
    expect(parsed.searchParams.get("count")).toBe("exact");
  });
});

describe("getRefreshPageCount", () => {
  it("refreshes every loaded page up to 2,000 rows in total", () => {
    expect(MAX_REFRESH_PAGES).toBe(20);
    expect(getRefreshPageCount(0)).toBe(0);
    expect(getRefreshPageCount(5)).toBe(5);
    expect(getRefreshPageCount(19)).toBe(19); // page 1 + 19 = 20 pages
    expect(getRefreshPageCount(40)).toBe(19); // the rest is dropped
  });
});

describe("mergeRows", () => {
  const id = (row: { id: string }) => row.id;

  it("keeps page 1's copy of a row that moved into a later page", () => {
    const first = [
      { id: "a", v: 2 },
      { id: "b", v: 2 }
    ];
    const later = [
      { id: "b", v: 1 },
      { id: "c", v: 1 }
    ];
    expect(mergeRows(first, later, id)).toEqual([
      { id: "a", v: 2 },
      { id: "b", v: 2 },
      { id: "c", v: 1 }
    ]);
  });

  it("returns page 1 itself when nothing else is loaded", () => {
    const first = [{ id: "a" }];
    expect(mergeRows(first, [], id)).toBe(first);
  });

  it("appends without a check when rows have no id", () => {
    expect(mergeRows([{ id: "a" }], [{ id: "a" }])).toHaveLength(2);
  });

  it("de-duplicates by another id column", () => {
    const byItem = (row: { itemId: string }) => readRowId(row, "itemId");
    expect(
      mergeRows([{ itemId: "a" }], [{ itemId: "a" }, { itemId: "b" }], byItem)
    ).toEqual([{ itemId: "a" }, { itemId: "b" }]);
  });
});

describe("readPage", () => {
  it("reads the rows and the cursor of a new page", () => {
    const data = { salesOrders: [{ id: "a" }], nextCursor: "c2", count: 0 };
    expect(readPage(data, undefined, "salesOrders")).toEqual({
      status: "ok",
      rows: [{ id: "a" }],
      nextCursor: "c2"
    });
    expect(
      readPage({ salesOrders: [], nextCursor: null }, undefined, "salesOrders")
    ).toMatchObject({ status: "ok", nextCursor: null });
  });

  it("is an error when the loader returns `listError`", () => {
    expect(
      readPage(
        { salesOrders: [], nextCursor: null, listError: "failed" },
        undefined,
        "salesOrders"
      )
    ).toEqual({ status: "error" });
  });

  it("ends the list when the next cursor repeats the one requested", () => {
    expect(
      readPage(
        { salesOrders: [], nextCursor: "c1" },
        undefined,
        "salesOrders",
        "c1"
      )
    ).toMatchObject({ status: "ok", nextCursor: null });
  });

  it("is an error when the data did not change, is missing or has no rows", () => {
    const data = { salesOrders: [] };
    expect(readPage(data, data, "salesOrders")).toEqual({ status: "error" });
    expect(readPage(undefined, undefined, "salesOrders")).toEqual({
      status: "error"
    });
    expect(readPage({ parts: [] }, undefined, "salesOrders")).toEqual({
      status: "error"
    });
  });
});
