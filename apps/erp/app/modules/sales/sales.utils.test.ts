import { describe, expect, it } from "vitest";
import {
  decideRecalcPricing,
  getEffectiveDefaultMarkups,
  leaseCommencementPreview,
  leaseTermMonths,
  previewLeaseClassification,
  readLeaseClassification,
  reconcileQuantityBreaks,
  resolvePreservedQuoteLinePriceFields
} from "./sales.utils";

describe("resolvePreservedQuoteLinePriceFields", () => {
  const stored = {
    leadTime: 14,
    discountPercent: 0.1,
    shippingCost: 5,
    categoryMarkups: { laborCost: 25 },
    priceSource: "system" as const
  };

  it("preserves stored values when the caller omits a field", () => {
    expect(resolvePreservedQuoteLinePriceFields({}, stored)).toEqual({
      leadTime: 14,
      discountPercent: 0.1,
      shippingCost: 5,
      categoryMarkups: { laborCost: 25 },
      priceSource: "system"
    });
  });

  it("lets an explicit value win over the stored one", () => {
    const result = resolvePreservedQuoteLinePriceFields(
      { leadTime: 3, discountPercent: 0.2, shippingCost: 0 },
      stored
    );
    expect(result.leadTime).toBe(3);
    expect(result.discountPercent).toBe(0.2);
    // An explicit zero is a real value, not "omitted".
    expect(result.shippingCost).toBe(0);
  });

  it("falls back to column defaults for a brand-new row", () => {
    expect(resolvePreservedQuoteLinePriceFields({}, null)).toEqual({
      leadTime: 0,
      discountPercent: 0,
      shippingCost: 0,
      categoryMarkups: {},
      // A hand-set price with no declared source is manual, not system.
      priceSource: "manual"
    });
  });

  it("marks an explicit price system when the caller says so", () => {
    expect(
      resolvePreservedQuoteLinePriceFields({ priceSource: "system" }, null)
        .priceSource
    ).toBe("system");
  });
});

describe("reconcileQuantityBreaks", () => {
  it("reports nothing when the breaks are unchanged", () => {
    expect(reconcileQuantityBreaks([1, 25, 50], [1, 25, 50])).toEqual({
      added: [],
      removed: []
    });
  });
  it("reports only additions when breaks are added", () => {
    expect(reconcileQuantityBreaks([24], [24, 32])).toEqual({
      added: [32],
      removed: []
    });
  });
  it("reports removals when a break is dropped — the orphan bug", () => {
    expect(reconcileQuantityBreaks([1, 24, 32], [24])).toEqual({
      added: [],
      removed: [1, 32]
    });
  });
  it("reports both sides of a swap", () => {
    expect(reconcileQuantityBreaks([1, 25], [25, 100])).toEqual({
      added: [100],
      removed: [1]
    });
  });
  it("removes every row when the line offers no breaks", () => {
    expect(reconcileQuantityBreaks([1, 24], [])).toEqual({
      added: [],
      removed: [1, 24]
    });
  });
  it("adds every break when no price rows exist yet", () => {
    expect(reconcileQuantityBreaks([], [1, 25])).toEqual({
      added: [1, 25],
      removed: []
    });
  });
  it("dedupes repeated quantities on either side", () => {
    expect(reconcileQuantityBreaks([24, 24], [32, 32])).toEqual({
      added: [32],
      removed: [24]
    });
  });
  it("handles fractional quantities (the column is NUMERIC(16,5))", () => {
    expect(reconcileQuantityBreaks([0.5, 1.25], [1.25, 2.5])).toEqual({
      added: [2.5],
      removed: [0.5]
    });
  });
});

describe("getEffectiveDefaultMarkups", () => {
  it("returns {} when all category defaults are 0 (feature disabled)", () => {
    expect(
      getEffectiveDefaultMarkups({ laborCost: 0, materialCost: 0 })
    ).toEqual({});
  });
  it("returns {} when the defaults object is empty", () => {
    expect(getEffectiveDefaultMarkups({})).toEqual({});
  });
  it("returns the defaults unchanged when at least one is positive", () => {
    const d = { laborCost: 30, materialCost: 0 };
    expect(getEffectiveDefaultMarkups(d)).toEqual(d);
  });
});

describe("decideRecalcPricing", () => {
  it("PRESERVES a manual row — no recalc may change a stated price", () => {
    expect(
      decideRecalcPricing(
        { priceSource: "manual", categoryMarkups: {} },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "preserve" });
  });
  it("preserves a manual row even when it has stale categoryMarkups", () => {
    expect(
      decideRecalcPricing(
        { priceSource: "manual", categoryMarkups: { laborCost: 20 } },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "preserve" });
  });
  it("preserves a manual row when defaults are disabled (the reported case)", () => {
    expect(
      decideRecalcPricing({ priceSource: "manual", categoryMarkups: {} }, {})
    ).toEqual({ mode: "preserve" });
  });
  it("reprices a system cost-plus row from its explicit categoryMarkups", () => {
    expect(
      decideRecalcPricing(
        { priceSource: "system", categoryMarkups: { laborCost: 20 } },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "reprice", markups: { laborCost: 20 } });
  });
  it("reprices a system row without markups from the effective defaults", () => {
    expect(
      decideRecalcPricing(
        { priceSource: "system", categoryMarkups: {} },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "reprice", markups: { laborCost: 30 } });
  });
  it("reprices a system row at cost (empty markups) when defaults are disabled — no freeze", () => {
    expect(
      decideRecalcPricing({ priceSource: "system", categoryMarkups: {} }, {})
    ).toEqual({ mode: "reprice", markups: {} });
  });
  it("treats null categoryMarkups as empty", () => {
    expect(
      decideRecalcPricing({ priceSource: "system", categoryMarkups: null }, {})
    ).toEqual({ mode: "reprice", markups: {} });
  });
  it("treats a null priceSource as system (legacy safety)", () => {
    expect(
      decideRecalcPricing(
        { priceSource: null, categoryMarkups: { laborCost: 20 } },
        {}
      )
    ).toEqual({ mode: "reprice", markups: { laborCost: 20 } });
  });
});

describe("leaseTermMonths", () => {
  it("counts whole months with both ends inclusive", () => {
    // The same pins as post-rental-agreement's `wholeMonthsInTerm`.
    expect(leaseTermMonths("2027-01-01", "2029-12-31")).toBe(36);
    expect(leaseTermMonths("2027-01-15", "2028-01-14")).toBe(12);
    expect(leaseTermMonths("2026-01-15", "2026-02-14")).toBe(1);
    expect(leaseTermMonths("2026-01-15", "2026-02-13")).toBe(0);
    expect(leaseTermMonths("2026-01-31", "2026-02-27")).toBe(0);
  });

  it("is null when open-ended", () => {
    expect(leaseTermMonths("2026-01-01", null)).toBeNull();
  });
});

describe("previewLeaseClassification", () => {
  const agreement = {
    startDate: "2026-01-01",
    endDate: "2028-12-31",
    billingCycle: "Calendar Month" as const,
    billingTiming: "Arrears" as const,
    discountRate: 6,
    ownershipTransfers: false,
    specializedAsset: false,
    purchaseOptionAmount: 5000,
    purchaseOptionReasonablyCertain: true
  };
  const line = {
    rateMode: "Best Rate" as const,
    rateUnit: null,
    fairValue: 38000,
    economicLifeMonths: 120,
    guaranteedResidualValue: 0,
    unguaranteedResidualValue: 0
  };
  const ladder = { dayRate: 100, weekRate: 400, monthRate: 1000 };
  const policy = { majorPartPercent: 75, substantiallyAllPercent: 90 };

  it("matches the shared math's pinned sales-type case", () => {
    const record = previewLeaseClassification({
      agreement,
      line,
      ladder,
      policy
    });
    expect(record.classification).toBe("Sales-Type");
    expect(record.periods).toBe(36);
    expect(record.pv?.netInvestment).toBeCloseTo(37049.24, 2);
    expect(record.tests).toEqual({
      a: false,
      b: true,
      c: false,
      d: true,
      e: false
    });
  });

  it("is operating when no test is met", () => {
    const record = previewLeaseClassification({
      agreement: { ...agreement, purchaseOptionReasonablyCertain: false },
      line: { ...line, fairValue: 60000 },
      ladder,
      policy
    });
    expect(record.classification).toBe("Operating");
  });

  it("values a 28 Days line over whole 28-day periods at a scaled rate", () => {
    const record = previewLeaseClassification({
      agreement: { ...agreement, billingCycle: "28 Days" },
      line,
      ladder,
      policy
    });
    // 1,096 days → 39 whole periods; 28 days bill a month tier (1,000).
    expect(record.periods).toBe(39);
    expect(record.payment).toBe(1000);
    expect(record.annualRate).toBeCloseTo((6 * 12 * 28) / 365, 5);
  });

  it("cannot price a line with no rates, and stays operating", () => {
    const record = previewLeaseClassification({
      agreement: { ...agreement, purchaseOptionReasonablyCertain: false },
      line,
      ladder: null,
      policy
    });
    expect(record.pv).toBeNull();
    expect(record.classification).toBe("Operating");
  });

  it("round-trips through the stored JSON shape", () => {
    const record = previewLeaseClassification({
      agreement,
      line,
      ladder,
      policy
    });
    const { classification: _, ...stored } = record;
    expect(
      readLeaseClassification(JSON.parse(JSON.stringify(stored)), "Sales-Type")
    ).toEqual(record);
    expect(readLeaseClassification(null, "Operating")).toBeNull();
  });
});

describe("leaseCommencementPreview", () => {
  it("balances: NI + (C − PVres) = PVpay + C", () => {
    const pv = {
      pvRent: 30000,
      pvPayments: 34000,
      pvResidual: 2000,
      netInvestment: 36000
    };
    const preview = leaseCommencementPreview(pv, 25000);
    expect(preview.costOfGoodsSold).toBe(23000);
    expect(preview.netInvestment + preview.costOfGoodsSold).toBe(
      preview.leaseRevenue + preview.carryingAmount
    );
    expect(preview.sellingProfit).toBe(11000);
  });
});
