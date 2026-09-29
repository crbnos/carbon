import { describe, expect, it } from "vitest";
import { encodeCsv, encodeCsvTable, parseCsv } from "./csv";

// stripCsvFormulaPrefix itself is pinned by apps/erp/app/utils/bom.test.ts;
// these tests cover what the ENCODERS add on top of papaparse.

describe("encodeCsv", () => {
  it("is injection-safe and never ships [object Object]", () => {
    const csv = encodeCsv([{ x: "=HYPERLINK()", y: { nested: true } }]);
    expect(csv).toBe('x,y\r\nHYPERLINK(),"{""nested"":true}"');
  });
  it("strips formula prefixes from headers too (import-error re-exports echo uploaded headers)", () => {
    const csv = encodeCsv([{ "=cmd|calc": "safe" }]);
    expect(csv).toBe("cmd|calc\r\nsafe");
  });
  it("respects an explicit field order and empty value", () => {
    const csv = encodeCsv([{ b: 1, a: 2 }], {
      fields: ["a", "b", "c"],
      emptyFieldValue: "-"
    });
    expect(csv).toBe("a,b,c\r\n2,1,-");
  });
});

describe("encodeCsvTable / parseCsv round trip", () => {
  it("round-trips through parse, sanitizing string cells", () => {
    const csv = encodeCsvTable(
      ["part", "note"],
      [
        ["P-1", "line one\nline two"],
        ["P-2", "=bad"]
      ]
    );
    const { rows, fields } = parseCsv<{ part: string; note: string }>(csv);
    expect(fields).toEqual(["part", "note"]);
    expect(rows).toEqual([
      { part: "P-1", note: "line one\nline two" },
      { part: "P-2", note: "bad" }
    ]);
  });
  it("trims headers and skips blank lines", () => {
    const { rows, fields } = parseCsv(" a , b \n1,2\n\n3,4\n");
    expect(fields).toEqual(["a", "b"]);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" }
    ]);
  });
});
