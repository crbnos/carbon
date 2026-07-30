import { describe, expect, it } from "vitest";
import { getOverReceiptViolations } from "./receiving";

describe("getOverReceiptViolations", () => {
  const poLine = (overrides = {}) => ({
    id: "pol1",
    purchaseQuantity: 20,
    quantityReceived: 0,
    itemReadableId: "CAM-01",
    ...overrides
  });

  it("returns no violations for an under-receipt", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 12, conversionFactor: 1 }],
      [poLine()]
    );
    expect(violations).toHaveLength(0);
  });

  it("returns no violations for an exact receipt", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 20, conversionFactor: 1 }],
      [poLine()]
    );
    expect(violations).toHaveLength(0);
  });

  it("warns when the receipt exceeds the ordered quantity", () => {
    const { violations, ruleNames } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 25, conversionFactor: 1 }],
      [poLine()]
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.severity).toBe("warn");
    expect(violations[0]?.ruleId).toBe("over-receipt:pol1");
    expect(violations[0]?.message).toContain("CAM-01");
    expect(violations[0]?.message).toContain("25");
    expect(violations[0]?.message).toContain("20");
    expect(ruleNames["over-receipt:pol1"]).toBe("Over Receipt");
  });

  it("counts previously received quantity toward the total", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 10, conversionFactor: 1 }],
      [poLine({ quantityReceived: 12 })]
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("22");
  });

  it("converts inventory units to purchase units via conversionFactor", () => {
    // 20 ordered in purchase units × factor 12 = 240 inventory units allowed.
    const exact = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 240, conversionFactor: 12 }],
      [poLine()]
    );
    expect(exact.violations).toHaveLength(0);

    const over = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 241, conversionFactor: 12 }],
      [poLine()]
    );
    expect(over.violations).toHaveLength(1);
  });

  it("does not flag float artifacts from unit conversion", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 6, conversionFactor: 3 }],
      [poLine({ purchaseQuantity: 2 })]
    );
    expect(violations).toHaveLength(0);
  });

  it("sums multiple receipt lines pointing at the same purchase order line", () => {
    const { violations } = getOverReceiptViolations(
      [
        { lineId: "pol1", receivedQuantity: 12, conversionFactor: 1 },
        { lineId: "pol1", receivedQuantity: 10, conversionFactor: 1 }
      ],
      [poLine()]
    );
    expect(violations).toHaveLength(1);
  });

  it("ignores receipt lines without a purchase order line reference", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: null, receivedQuantity: 100, conversionFactor: 1 }],
      [poLine()]
    );
    expect(violations).toHaveLength(0);
  });

  it("treats a missing or zero conversion factor as 1", () => {
    const { violations } = getOverReceiptViolations(
      [{ lineId: "pol1", receivedQuantity: 25, conversionFactor: 0 }],
      [poLine()]
    );
    expect(violations).toHaveLength(1);
  });
});
