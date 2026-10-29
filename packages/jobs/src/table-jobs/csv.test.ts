// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  encodeExportHeader,
  encodeExportRows,
  formatExportValue,
  readExportValue
} from "./csv";
import { TABLE_JOB_PAGE_SIZE } from "./paging";

describe("readExportValue", () => {
  it("reads a plain column", () => {
    expect(readExportValue({ status: "Draft" }, "status")).toBe("Draft");
  });

  it("reads a custom field from customFields", () => {
    const row = { customFields: { qzAx: "Blue" } };
    expect(readExportValue(row, "customFields->>qzAx")).toBe("Blue");
  });

  it("reads nothing when the row has no custom fields", () => {
    expect(
      readExportValue({ customFields: null }, "customFields->>qzAx")
    ).toBeUndefined();
    expect(readExportValue({}, "customFields->>qzAx")).toBeUndefined();
  });
});

describe("formatExportValue", () => {
  it("keeps plain values as they are", () => {
    expect(formatExportValue("2026-10-13")).toBe("2026-10-13");
    expect(formatExportValue(1250.5)).toBe(1250.5);
    expect(formatExportValue(false)).toBe(false);
    expect(formatExportValue(null)).toBeNull();
    expect(formatExportValue(undefined)).toBeNull();
  });

  it("joins an array with semicolons", () => {
    expect(formatExportValue(["red", "blue", null, 3])).toBe("red; blue; 3");
  });

  it("writes an object as JSON", () => {
    expect(formatExportValue({ name: "Acme" })).toBe('{"name":"Acme"}');
    expect(formatExportValue([{ id: 1 }])).toBe('{"id":1}');
  });
});

describe("encodeExportHeader / encodeExportRows", () => {
  const columns = [
    { key: "id", label: "Name" },
    { key: "customFields->>c1", label: "Name" },
    { key: "tags", label: "Tags" }
  ];

  it("writes the labels once and the rows without a header", () => {
    const header = encodeExportHeader(columns);
    const rows = encodeExportRows(
      [{ id: "SO-1", customFields: { c1: "x" }, tags: ["a", "b"] }],
      columns
    );
    expect(header).toBe("Name,Name,Tags");
    expect(rows).toBe("SO-1,x,a; b");
  });

  it("strips a formula prefix from a cell", () => {
    expect(
      encodeExportRows([{ id: "=SUM(A1)" }], [{ key: "id", label: "Name" }])
    ).toBe("SUM(A1)");
  });

  it("returns an empty string for an empty page", () => {
    expect(encodeExportRows([], columns)).toBe("");
  });

  it("keeps the page below PostgREST's max_rows", () => {
    expect(TABLE_JOB_PAGE_SIZE + 1).toBeLessThanOrEqual(1000);
  });
});
