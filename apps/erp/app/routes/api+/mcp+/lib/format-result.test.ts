// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  formatMcpResult,
  MCP_MAX_CHARS,
  MCP_MAX_ROWS,
  pageMcpListResult,
  projectFields,
  stripNulls
} from "@carbon/ee/mcp";
import { describe, expect, it } from "vitest";

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
  const lines = (text: string) => text.split(/\r?\n/);

  it("writes a list of records as CSV, one header and one line per record", () => {
    const text = formatMcpResult(
      [
        { id: "a", name: "Bolt, M4", qty: 2, active: true, fax: null },
        { id: "b", name: 'Say "hi"', qty: 0, active: false, tags: ["x"] }
      ],
      { name: "items_getParts" }
    );
    expect(lines(text)).toEqual([
      "# items_getParts.csv",
      "id,name,qty,active,tags",
      'a,"Bolt, M4",2,true,',
      'b,"Say ""hi""",0,false,"[""x""]"'
    ]);
  });

  it("keeps string cells as written and drops columns no row uses", () => {
    const text = formatMcpResult([
      { id: "a", phone: "+1 555 0100", fax: null },
      { id: "b", phone: "=draft" }
    ]);
    expect(lines(text)).toEqual([
      "# results.csv",
      "id,phone",
      "a,+1 555 0100",
      "b,=draft"
    ]);
  });

  it("keeps a single record, and a list of plain values, as JSON", () => {
    expect(formatMcpResult({ id: "a", fax: null })).toBe('{"id":"a"}');
    expect(formatMcpResult(["a", "b"])).toBe('["a","b"]');
    expect(formatMcpResult([])).toBe("[]");
  });

  it("caps rows at MCP_MAX_ROWS and names the next offset", () => {
    const rows = Array.from({ length: MCP_MAX_ROWS + 40 }, (_, i) => ({
      id: i
    }));
    const text = formatMcpResult(rows);
    expect(lines(text)[2]).toBe("0");
    expect(lines(text)).not.toContain(String(MCP_MAX_ROWS));
    expect(text).toContain(
      `(rows 1-${MCP_MAX_ROWS} of ${MCP_MAX_ROWS + 40}; next page: offset ${MCP_MAX_ROWS}, output capped`
    );
  });

  it("stops at the character budget but always returns one row", () => {
    const wide = { id: 0, notes: "x".repeat(MCP_MAX_CHARS / 4) };
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...wide, id: i }));
    const text = formatMcpResult(rows, { count: 50, offset: 20 });
    expect(lines(text).filter((line) => /^\d+,x/.test(line))).toHaveLength(3);
    expect(text.length).toBeLessThan(MCP_MAX_CHARS + 300);
    expect(text).toContain("(rows 21-23 of 50; next page: offset 23");
    expect(text).toContain("pass `fields`");
    expect(text).toContain("`truncate: false`");

    const huge = [{ notes: "x".repeat(MCP_MAX_CHARS * 2) }, { id: 1 }];
    expect(formatMcpResult(huge)).toContain("(rows 1-1 of 2;");
  });

  it("returns every row with truncate false", () => {
    const rows = Array.from({ length: MCP_MAX_ROWS + 40 }, (_, i) => ({
      id: i,
      notes: "x".repeat(500)
    }));
    const text = formatMcpResult(rows, { truncate: false });
    expect(lines(text)).toHaveLength(MCP_MAX_ROWS + 40 + 2);
    expect(text).not.toContain("next page");
  });

  it("names the next offset when the read was paginated short", () => {
    const text = formatMcpResult([{ id: "a" }], { count: 240, offset: 25 });
    expect(lines(text)).toEqual([
      "# results.csv",
      "id",
      "a",
      "(rows 26-26 of 240; next page: offset 26)"
    ]);
  });

  it("omits the footer when everything was returned", () => {
    expect(lines(formatMcpResult([{ id: "a" }], { count: 1 }))).toEqual([
      "# results.csv",
      "id",
      "a"
    ]);
    expect(
      formatMcpResult([{ id: "b" }], { count: 26, offset: 25 })
    ).not.toContain("rows");
  });
});

describe("projectFields", () => {
  it("keeps only the named fields of each row", () => {
    expect(
      projectFields(
        [
          { id: "a", name: "A", wide: 1 },
          { id: "b", wide: 2 }
        ],
        ["id", "name"]
      )
    ).toEqual([{ id: "a", name: "A" }, { id: "b" }]);
    expect(projectFields({ id: "a", wide: 1 }, ["id"])).toEqual({ id: "a" });
  });

  it("passes data through when no fields are named", () => {
    const rows = [{ id: "a" }];
    expect(projectFields(rows, undefined)).toBe(rows);
    expect(projectFields(rows, [])).toBe(rows);
    expect(projectFields(["a", 1], ["id"])).toEqual(["a", 1]);
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
    expect(formatMcpResult(page, { count: total }).split(/\r?\n/)).toEqual([
      "# results.csv",
      "id",
      "0",
      "(rows 1-1 of 10; next page: offset 1)"
    ]);
  });
});
