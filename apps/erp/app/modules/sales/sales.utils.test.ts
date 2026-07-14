import { describe, expect, it } from "vitest";
import { decideRecalcPricing, getEffectiveDefaultMarkups } from "./sales.utils";

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
  it("reprices a cost-plus row from its explicit categoryMarkups", () => {
    expect(
      decideRecalcPricing(
        { categoryMarkups: { laborCost: 20 }, unitPrice: 120 },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "reprice", markups: { laborCost: 20 } });
  });
  it("PRESERVES a fixed-price row (empty markups, price set) — default never overrides", () => {
    expect(
      decideRecalcPricing(
        { categoryMarkups: {}, unitPrice: 110 },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "preserve" });
  });
  it("preserves a fixed-price row even when the default is 0% (the reported case)", () => {
    expect(
      decideRecalcPricing({ categoryMarkups: {}, unitPrice: 110 }, {})
    ).toEqual({ mode: "preserve" });
  });
  it("treats null categoryMarkups as empty", () => {
    expect(
      decideRecalcPricing({ categoryMarkups: null, unitPrice: 110 }, {})
    ).toEqual({ mode: "preserve" });
  });
  it("prices an unpriced row from the effective defaults", () => {
    expect(
      decideRecalcPricing(
        { categoryMarkups: {}, unitPrice: 0 },
        { laborCost: 30 }
      )
    ).toEqual({ mode: "reprice", markups: { laborCost: 30 } });
  });
  it("prices an unpriced row at cost (empty markups) when defaults are disabled", () => {
    expect(
      decideRecalcPricing({ categoryMarkups: {}, unitPrice: 0 }, {})
    ).toEqual({ mode: "reprice", markups: {} });
  });
});
