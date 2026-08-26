import { describe, expect, it } from "vitest";
import { serializeCsv, serializeCsvRows } from "./exportReport";

describe("serializeCsvRows", () => {
  it("preserves duplicate headers and their distinct positional values", () => {
    expect(
      serializeCsvRows([
        ["", "Jan 2026", "Jan 2026"],
        ["Alpha", "12", "34"]
      ])
    ).toBe(",Jan 2026,Jan 2026\r\nAlpha,12,34");
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

  it("prefixes every formula-trigger string while preserving numeric values", () => {
    expect(
      serializeCsv([
        {
          Formula: "=SUM(A1:A2)",
          Plus: "+malicious",
          Minus: "-malicious",
          At: "@malicious",
          MinusDigits: "-001",
          PlusDigits: "+001",
          Number: -42,
          Decimal: 1.5
        }
      ])
    ).toBe(
      "Formula,Plus,Minus,At,MinusDigits,PlusDigits,Number,Decimal\r\n'=SUM(A1:A2),'+malicious,'-malicious,'@malicious,'-001,'+001,-42,1.5"
    );
  });

  it("returns no rows for empty input", () => {
    expect(serializeCsv([])).toBe("");
  });
});
