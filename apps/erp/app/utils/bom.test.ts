import { describe, expect, it } from "vitest";
import { stripCsvFormulaPrefix } from "./bom";

describe("stripCsvFormulaPrefix", () => {
  it("strips formula-leading characters from non-numeric strings", () => {
    expect(stripCsvFormulaPrefix('=cmd|" /C calc"!A0')).toBe(
      'cmd|" /C calc"!A0'
    );
    expect(stripCsvFormulaPrefix("+SUM(A1:A2)")).toBe("SUM(A1:A2)");
    expect(stripCsvFormulaPrefix("-HYPERLINK(...)")).toBe("HYPERLINK(...)");
    expect(stripCsvFormulaPrefix("@evil")).toBe("evil");
  });

  it("strips prefixes hidden behind leading whitespace", () => {
    expect(stripCsvFormulaPrefix("  =1+1")).toBe("1+1");
    expect(stripCsvFormulaPrefix("\t@evil")).toBe("evil");
  });

  it("leaves numeric strings and negative numbers untouched", () => {
    expect(stripCsvFormulaPrefix("-5.5")).toBe("-5.5");
    expect(stripCsvFormulaPrefix("100")).toBe("100");
  });

  it("leaves ordinary values untouched", () => {
    expect(stripCsvFormulaPrefix("Raw Materials")).toBe("Raw Materials");
    expect(stripCsvFormulaPrefix("")).toBe("");
  });
});
