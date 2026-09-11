import { describe, expect, it } from "vitest";
import {
  formatMcpResult,
  MCP_MAX_ROWS,
  pageMcpListResult,
  stripNulls
} from "./format-result";

describe("stripNulls", () => {
  it("drops null and undefined object entries, recursively", () => {
    expect(
      stripNulls({
        id: "a",
        fax: null,
        customFields: undefined,
        nested: { workPhone: null, name: "x" }
      })
    ).toEqual({ id: "a", nested: { name: "x" } });
  });

  it("keeps array elements positionally and empty values", () => {
    expect(stripNulls([1, null, { a: null, b: "" }])).toEqual([
      1,
      null,
      { b: "" }
    ]);
    expect(stripNulls({ tags: [], notes: "" })).toEqual({
      tags: [],
      notes: ""
    });
  });
});

describe("formatMcpResult", () => {
  it("serializes compactly with nulls stripped", () => {
    const text = formatMcpResult([{ id: "a", fax: null }]);
    expect(text).toBe('[{"id":"a"}]');
  });

  it("caps rows at MCP_MAX_ROWS with an omission marker", () => {
    const rows = Array.from({ length: MCP_MAX_ROWS + 40 }, (_, i) => ({
      id: i
    }));
    const text = formatMcpResult(rows);
    expect(text).toContain('{"id":0}');
    expect(text).not.toContain(`{"id":${MCP_MAX_ROWS}}`);
    expect(text).toContain("… 40 more rows omitted");
  });

  it("appends the count line when the read was paginated short", () => {
    const text = formatMcpResult([{ id: "a" }], 240);
    expect(text).toContain("(showing 1 of 240 rows)");
  });

  it("omits the count line when everything was returned", () => {
    expect(formatMcpResult([{ id: "a" }], 1)).toBe('[{"id":"a"}]');
  });
});

describe("pageMcpListResult", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));

  it("slices to the requested page and reports the full total", () => {
    expect(pageMcpListResult(rows, { limit: 3, offset: 0 })).toEqual({
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      total: 10
    });
    expect(pageMcpListResult(rows, { limit: 3, offset: 9 })).toEqual({
      rows: [{ id: 9 }],
      total: 10
    });
  });

  it("passes non-array data through untouched", () => {
    expect(pageMcpListResult({ id: "a" }, { limit: 3, offset: 0 })).toEqual({
      rows: { id: "a" }
    });
  });

  it("composes with formatMcpResult's showing line", () => {
    const { rows: page, total } = pageMcpListResult(rows, {
      limit: 1,
      offset: 0
    });
    expect(formatMcpResult(page, total)).toBe(
      '[{"id":0}]\n(showing 1 of 10 rows)'
    );
  });
});
