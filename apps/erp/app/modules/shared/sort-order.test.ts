// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseSortOrderUpdates, updateSortOrder } from "./sort-order";

describe("updateSortOrder", () => {
  // Both guards return before any statement, so no database is needed.
  const base = {
    table: "quoteLine" as const,
    column: "sortOrder" as const,
    companyId: "c1",
    userId: "u1",
    parent: { column: "quoteId" as const, id: "q1" },
    updates: [{ id: "ql1", sortOrder: 1 }]
  };

  it("refuses an empty parent id instead of issuing an update scoped to no document", async () => {
    await expect(
      updateSortOrder(null as never, {
        ...base,
        parent: { column: "quoteId", id: "" }
      })
    ).rejects.toThrow("quoteLine: missing parent id");
  });

  it("does nothing for an empty reorder", async () => {
    await expect(
      updateSortOrder(null as never, { ...base, updates: [] })
    ).resolves.toBeUndefined();
  });
});

describe("parseSortOrderUpdates", () => {
  const form = (updates?: string) => {
    const formData = new FormData();
    if (updates !== undefined) formData.set("updates", updates);
    return formData;
  };

  it("reads the id → sort order map the drag-sort UI posts", () => {
    expect(parseSortOrderUpdates(form('{"ql1":2,"ql2":"1.5"}'))).toEqual([
      { id: "ql1", sortOrder: 2 },
      { id: "ql2", sortOrder: 1.5 }
    ]);
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{ql1: 2"],
    ["empty", "{}"],
    ["NaN", '{"ql1":"abc"}'],
    ["blank string (Number() would make it 0)", '{"ql1":""}'],
    ["null", '{"ql1":null}'],
    ["an array", "[1,2]"]
  ])("rejects %s", (_label, updates) => {
    expect(parseSortOrderUpdates(form(updates))).toBeNull();
  });
});
