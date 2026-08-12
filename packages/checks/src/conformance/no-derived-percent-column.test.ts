import { describe, expect, it } from "vitest";
import { noDerivedPercentColumn } from "./no-derived-percent-column";

describe("no-derived-percent-column", () => {
  it("flags a generated percent column that divides", () => {
    const sql = `ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxPercent" NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost") = 0 THEN 0
    ELSE "supplierTaxAmount" / ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost")
  END
) STORED;`;
    const violations = noDerivedPercentColumn.scan("a.sql", sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.snippet).toContain("taxPercent");
  });

  it("flags a rate column derived on a single line", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "marginRate" NUMERIC GENERATED ALWAYS AS ("profit" / "revenue") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(1);
  });

  it("allows a generated percent column without division", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "combinedPercent" NUMERIC GENERATED ALWAYS AS ("aPercent" + "bPercent") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows plain stored percent columns", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "taxPercent" NUMERIC NOT NULL DEFAULT 0;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows generated non-percent columns that divide", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS ("supplierUnitPrice" / "exchangeRate") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });

  it("stops at a same-line terminator instead of swallowing what follows", () => {
    // The percent column is self-contained and does not divide. The division
    // below belongs to a different column; a multiline walk that ignored the
    // terminator on line 1 would blame it on the percent column.
    const sql = [
      `ALTER TABLE "t" ADD COLUMN "combinedPercent" NUMERIC GENERATED ALWAYS AS ("aPercent" + "bPercent") STORED;`,
      `ALTER TABLE "t" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS ("supplierUnitPrice" / "exchangeRate") STORED;`
    ].join("\n");
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });
});
