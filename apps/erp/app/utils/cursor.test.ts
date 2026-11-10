// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildKeysetFilter,
  cursorMatchesSorts,
  decodeCursor,
  decodeOffsetToken,
  encodeCursor,
  encodeOffsetToken,
  keysetKeys,
  readSortValue,
  toPage
} from "./cursor";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor, including non-ASCII text and arrays", () => {
    const cursor = {
      values: ['Müller, (GmbH) "quoted"', 12.5, true, null, ["a", "b"]],
      id: "so_123",
      keys: ["name:asc", "total:desc", "paid:asc", "dueDate:asc", "tags:asc"]
    };
    const token = encodeCursor(cursor);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(cursor);
  });

  it("returns null for a missing token", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(decodeCursor("not a cursor!!")).toBeNull();
    expect(decodeCursor("e30")).toBeNull(); // "{}"
    expect(decodeCursor(btoa(JSON.stringify({ values: [{}], id: "x" })))).toBe(
      null
    );
    expect(
      decodeCursor(btoa(JSON.stringify({ values: [], id: 1, keys: [] })))
    ).toBe(null);
  });

  it("returns null for a cursor without the sorts it was cut for", () => {
    expect(decodeCursor(btoa(JSON.stringify({ values: [], id: "x" })))).toBe(
      null
    );
  });
});

describe("cursorMatchesSorts", () => {
  const sorts = [{ column: "createdAt", ascending: false }];
  const cursor = {
    values: ["2026-10-13"],
    id: "so_1",
    keys: keysetKeys(sorts)
  };

  it("accepts a cursor cut for the same order", () => {
    expect(cursorMatchesSorts(cursor, sorts)).toBe(true);
  });

  it("rejects a cursor cut for another column or direction", () => {
    expect(
      cursorMatchesSorts(cursor, [{ column: "dueDate", ascending: false }])
    ).toBe(false);
    expect(
      cursorMatchesSorts(cursor, [{ column: "createdAt", ascending: true }])
    ).toBe(false);
  });

  it("rejects a cursor cut for more or fewer sorts", () => {
    expect(cursorMatchesSorts(cursor, [])).toBe(false);
    expect(
      cursorMatchesSorts(cursor, [
        ...sorts,
        { column: "name", ascending: true }
      ])
    ).toBe(false);
  });
});

describe("encodeOffsetToken / decodeOffsetToken", () => {
  it("round-trips an offset", () => {
    expect(decodeOffsetToken(encodeOffsetToken(300))).toBe(300);
  });

  it("reads a missing, malformed or negative token as 0", () => {
    expect(decodeOffsetToken(null)).toBe(0);
    expect(decodeOffsetToken("garbage!!")).toBe(0);
    expect(decodeOffsetToken(btoa(JSON.stringify({ offset: -5 })))).toBe(0);
    expect(decodeOffsetToken(btoa(JSON.stringify({ offset: "9" })))).toBe(0);
  });
});

describe("buildKeysetFilter", () => {
  it("one ascending sort: larger values, then NULLs, then ties by id", () => {
    expect(
      buildKeysetFilter(
        [{ column: "name", ascending: true }],
        { values: ["Bolt"], id: "it_1" },
        "id"
      )
    ).toBe('name.gt."Bolt",name.is.null,and(name.eq."Bolt",id.gt."it_1")');
  });

  it("one descending sort: smaller values, then ties by id", () => {
    expect(
      buildKeysetFilter(
        [{ column: "createdAt", ascending: false }],
        { values: ["2026-10-13T10:00:00+00:00"], id: "so_9" },
        "id"
      )
    ).toBe(
      'createdAt.lt."2026-10-13T10:00:00+00:00",and(createdAt.eq."2026-10-13T10:00:00+00:00",id.gt."so_9")'
    );
  });

  it("two sorts: each branch fixes the earlier sorts with equality", () => {
    expect(
      buildKeysetFilter(
        [
          { column: "status", ascending: true },
          { column: "dueDate", ascending: false }
        ],
        { values: ["Open", "2026-11-01"], id: "j_4" },
        "id"
      )
    ).toBe(
      [
        'status.gt."Open"',
        "status.is.null",
        'and(status.eq."Open",dueDate.lt."2026-11-01")',
        'and(status.eq."Open",dueDate.eq."2026-11-01",id.gt."j_4")'
      ].join(",")
    );
  });

  it("a NULL value, ascending: only later NULLs by id can follow", () => {
    expect(
      buildKeysetFilter(
        [{ column: "dueDate", ascending: true }],
        { values: [null], id: "j_4" },
        "id"
      )
    ).toBe('and(dueDate.is.null,id.gt."j_4")');
  });

  it("a NULL value, descending: every non-NULL value follows", () => {
    expect(
      buildKeysetFilter(
        [{ column: "dueDate", ascending: false }],
        { values: [null], id: "j_4" },
        "id"
      )
    ).toBe('dueDate.not.is.null,and(dueDate.is.null,id.gt."j_4")');
  });

  it("quotes and escapes commas, parentheses and quotes", () => {
    const value = 'Washer, Flat (M8) "zinc" \\ end';
    expect(
      buildKeysetFilter(
        [{ column: "name", ascending: false }],
        { values: [value], id: 'a"b' },
        "id"
      )
    ).toBe(
      'name.lt."Washer, Flat (M8) \\"zinc\\" \\\\ end",and(name.eq."Washer, Flat (M8) \\"zinc\\" \\\\ end",id.gt."a\\"b")'
    );
  });

  it("writes numbers and booleans in quoted string form", () => {
    expect(
      buildKeysetFilter(
        [
          { column: "quantity", ascending: true },
          { column: "active", ascending: false }
        ],
        { values: [12.5, true], id: "x" },
        "id"
      )
    ).toBe(
      [
        'quantity.gt."12.5"',
        "quantity.is.null",
        'and(quantity.eq."12.5",active.lt."true")',
        'and(quantity.eq."12.5",active.eq."true",id.gt."x")'
      ].join(",")
    );
  });

  it("writes an array as a quoted Postgres array literal", () => {
    expect(
      buildKeysetFilter(
        [{ column: "tags", ascending: false }],
        { values: [["a", 'b"c']], id: "x" },
        "id"
      )
    ).toBe(
      'tags.lt."{\\"a\\",\\"b\\\\\\"c\\"}",and(tags.eq."{\\"a\\",\\"b\\\\\\"c\\"}",id.gt."x")'
    );
  });

  it("uses a custom-field column as written", () => {
    expect(
      buildKeysetFilter(
        [{ column: "customFields->>color", ascending: true }],
        { values: ["Red"], id: "x" },
        "id"
      )
    ).toBe(
      'customFields->>color.gt."Red",customFields->>color.is.null,and(customFields->>color.eq."Red",id.gt."x")'
    );
  });

  it("uses the list's own id column as the tie-breaker", () => {
    expect(
      buildKeysetFilter(
        [{ column: "name", ascending: false }],
        { values: ["A"], id: "sc_1" },
        "supplierContactId"
      )
    ).toBe('name.lt."A",and(name.eq."A",supplierContactId.gt."sc_1")');
  });

  it("adds no tie-breaker when the last sort is the id itself", () => {
    expect(
      buildKeysetFilter(
        [{ column: "id", ascending: false }],
        { values: ["x"], id: "x" },
        "id"
      )
    ).toBe('id.lt."x"');
  });

  it("with no sorts, pages by id alone", () => {
    expect(buildKeysetFilter([], { values: [], id: "x" }, "id")).toBe(
      'id.gt."x"'
    );
  });
});

describe("readSortValue", () => {
  it("reads a plain column and turns undefined into null", () => {
    expect(readSortValue({ name: "Bolt" }, "name")).toBe("Bolt");
    expect(readSortValue({}, "name")).toBeNull();
  });

  it("reads a custom field as text", () => {
    const row = { customFields: { color: "Red", size: 4 } };
    expect(readSortValue(row, "customFields->>color")).toBe("Red");
    expect(readSortValue(row, "customFields->>size")).toBe("4");
    expect(readSortValue(row, "customFields->>missing")).toBeNull();
    expect(readSortValue({ customFields: null }, "customFields->>x")).toBe(
      null
    );
  });
});

describe("toPage", () => {
  const sorts = [{ column: "name", ascending: true }];
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `it_${i}`,
      name: `Item ${String(i).padStart(3, "0")}`
    }));

  it("drops the extra row and builds the cursor from the last kept row", () => {
    const page = toPage(rows(4), { limit: 3, sorts });
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor)).toEqual({
      values: ["Item 002"],
      id: "it_2",
      keys: ["name:asc"]
    });
  });

  it("returns every row and no cursor on the last page", () => {
    const page = toPage(rows(2), { limit: 3, sorts });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("reads the tie-breaker from a custom id column", () => {
    const page = toPage(
      [
        { supplierContactId: "a", name: "A" },
        { supplierContactId: "b", name: "B" }
      ],
      { limit: 1, sorts, idColumn: "supplierContactId" }
    );
    expect(decodeCursor(page.nextCursor)).toEqual({
      values: ["A"],
      id: "a",
      keys: ["name:asc"]
    });
  });

  it("ends the list when a sort column is not in the row", () => {
    const page = toPage(rows(4), {
      limit: 3,
      sorts: [{ column: "dueDate", ascending: true }]
    });
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("ends the list when the id column is not in the row", () => {
    const page = toPage(rows(4), { limit: 3, sorts, idColumn: "itemId" });
    expect(page.nextCursor).toBeNull();
  });

  it("resolves the order from the list's paging", () => {
    const paging = {
      defaultSorts: [
        { column: "name", ascending: true },
        { column: "name", ascending: true, foreignTable: "supplier" }
      ]
    };
    const fromDefaults = toPage(rows(4), { limit: 3 }, paging);
    expect(decodeCursor(fromDefaults.nextCursor)?.keys).toEqual(["name:asc"]);

    const fromUser = toPage(
      rows(4),
      { limit: 3, sorts: [{ sortBy: "id", sortAsc: false }] },
      paging
    );
    expect(decodeCursor(fromUser.nextCursor)).toEqual({
      values: ["it_2"],
      id: "it_2",
      keys: ["id:desc"]
    });
  });

  it("does not require a custom-field sort column to be a top-level key", () => {
    const page = toPage(
      [
        { id: "x", customFields: {} },
        { id: "y", customFields: {} }
      ],
      { limit: 1, sorts: [{ column: "customFields->>color", ascending: true }] }
    );
    expect(page.nextCursor).not.toBeNull();
  });
});
