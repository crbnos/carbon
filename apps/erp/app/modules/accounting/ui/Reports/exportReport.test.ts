import { describe, expect, it } from "vitest";
import {
  canExportExecutivePnl,
  csvText,
  serializeCsv,
  serializeCsvRows
} from "./exportReport";

describe("serializeCsvRows", () => {
  it("preserves duplicate headers and their distinct positional values", () => {
    expect(
      serializeCsvRows([
        ["", "Jan 2026", "Jan 2026"],
        ["Alpha", "12", "34"]
      ])
    ).toBe(",Jan 2026,Jan 2026\r\nAlpha,12,34");
  });

  it("protects formula-trigger strings after leading whitespace and controls", () => {
    expect(
      serializeCsvRows([
        ["Label", "Value"],
        ["Tab", "\t=SUM(A1:A2)"],
        ["Space", "  +malicious"],
        ["CRLF", "\r\n-malicious"],
        ["Numeric", -42]
      ])
    ).toBe(
      "Label,Value\r\nTab,'\t=SUM(A1:A2)\r\nSpace,'  +malicious\r\nCRLF,\"'\r\n-malicious\"\r\nNumeric,-42"
    );
  });

  it("accepts explicit text cells without deduplicating positional headers", () => {
    expect(
      serializeCsvRows([
        ["", csvText("00123"), csvText("00123")],
        [csvText("00456"), 12, 34]
      ])
    ).toBe(",'00123,'00123\r\n'00456,12,34");
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

  it("protects formula-trigger strings after leading whitespace and controls", () => {
    expect(
      serializeCsv([
        {
          Tab: "\t=SUM(A1:A2)",
          Space: "  +malicious",
          CRLF: "\r\n-malicious",
          Number: -42
        }
      ])
    ).toBe(
      "Tab,Space,CRLF,Number\r\n'\t=SUM(A1:A2),'  +malicious,\"'\r\n-malicious\",-42"
    );
  });

  it("preserves explicitly marked numeric-looking business text", () => {
    expect(
      serializeCsv([
        {
          Account: csvText("00123"),
          Unmarked: "0007",
          Amount: 7
        }
      ])
    ).toBe("Account,Unmarked,Amount\r\n'00123,0007,7");
  });

  it("returns no rows for empty input", () => {
    expect(serializeCsv([])).toBe("");
  });
});

describe("canExportExecutivePnl", () => {
  it("rejects an empty source report", () => {
    expect(canExportExecutivePnl([])).toBe(false);
  });
});
