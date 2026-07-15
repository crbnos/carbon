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
