import { describe, expect, it } from "vitest";
import { csvRowsToRecords, serializeCsv } from "./exportReport";

describe("csvRowsToRecords", () => {
  it("keeps matrix headers and row values in order", () => {
    expect(
      csvRowsToRecords([
        ["", "Jan 2026", "Total"],
        ["  Alpha", "12", "12"]
      ])
    ).toEqual([{ "": "  Alpha", "Jan 2026": "12", Total: "12" }]);
  });
});

describe("serializeCsv", () => {
  it("keeps the first-seen header order and escapes CSV values", () => {
    expect(
      serializeCsv([
        {
          Name: 'Acme, "North"',
          Note: "line one\nline two",
          Amount: 12
        }
      ])
    ).toBe('Name,Note,Amount\r\n"Acme, ""North""","line one\nline two",12');
  });

  it("prefixes formula-like strings while preserving numeric text", () => {
    expect(
      serializeCsv([
        {
          Formula: "=SUM(A1:A2)",
          Plus: "+malicious",
          Minus: "-malicious",
          At: "@malicious",
          Number: 42,
          Decimal: 1.5
        }
      ])
    ).toBe(
      "Formula,Plus,Minus,At,Number,Decimal\r\n'=SUM(A1:A2),'+malicious,'-malicious,'@malicious,42,1.5"
    );
  });

  it("returns no rows for empty input", () => {
    expect(serializeCsv([])).toBe("");
  });
});
