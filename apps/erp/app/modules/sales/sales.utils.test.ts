// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  applyPriceRules,
  configurationSurcharge,
  configuredQuoteBasePrice,
  decideRecalcPricing,
  getEffectiveDefaultMarkups,
  reconcileQuantityBreaks,
  repricedUnitPrice,
  resolveJobConfiguration,
  resolvePreservedQuoteLinePriceFields,
  toMatchedRule,
  withBasePriceSource
} from "./sales.utils";
import type { MatchedRule } from "./types";

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

describe("configurationSurcharge", () => {
  it("prices a list option only when it is the chosen value", () => {
    const price = { key: "color", value: "Red", amount: 10 };
    expect(configurationSurcharge(price, { color: "Red" })).toBe(10);
    expect(configurationSurcharge(price, { color: "Blue" })).toBe(0);
  });

  it("prices a boolean when it is true", () => {
    const price = { key: "anodized", value: "true", amount: 4 };
    expect(configurationSurcharge(price, { anodized: true })).toBe(4);
    expect(configurationSurcharge(price, { anodized: false })).toBe(0);
  });

  it("prices a numeric parameter per unit of its value", () => {
    const price = { key: "length", value: null, amount: 0.5 };
    expect(configurationSurcharge(price, { length: 120 })).toBe(60);
    expect(configurationSurcharge(price, { length: "12" })).toBe(6);
  });

  it("adds nothing for a missing or non-numeric value", () => {
    const price = { key: "length", value: null, amount: 0.5 };
    expect(configurationSurcharge(price, {})).toBe(0);
    expect(configurationSurcharge(price, { length: "" })).toBe(0);
    expect(configurationSurcharge(price, { length: "abc" })).toBe(0);
  });

  it("keeps a negative amount as a credit", () => {
    const price = { key: "color", value: "Raw", amount: -3 };
    expect(configurationSurcharge(price, { color: "Raw" })).toBe(-3);
  });
});

describe("applyPriceRules with configuration prices", () => {
  const rule = (overrides: Partial<MatchedRule>): MatchedRule => ({
    id: "pr1",
    name: "Rule",
    ruleType: "Markup",
    amountType: "Fixed",
    amount: 0,
    priority: 0,
    configurationPrices: [],
    ...overrides
  });

  it("adds surcharges to the starting price before the discount", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        rule({
          id: "options",
          ruleType: "Configuration",
          configurationPrices: [
            { key: "color", value: "Red", amount: 20 },
            { key: "length", value: null, amount: 1 }
          ]
        }),
        rule({
          id: "discount",
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        })
      ],
      { configuration: { color: "Red", length: 30 } }
    );
    // (100 + 20 + 30) × 0.9
    expect(finalPrice).toBeCloseTo(135);
    expect(appendedTrace.map((step) => step.step)).toEqual([
      "Configuration",
      "Configuration",
      "Discount"
    ]);
  });

  it("names a configuration step by its parameter label", () => {
    const { appendedTrace } = applyPriceRules(
      100,
      [
        rule({
          name: "Options",
          ruleType: "Configuration",
          configurationPrices: [
            { key: "a3", value: "Green", amount: 400, label: "Color" }
          ]
        })
      ],
      { configuration: { a3: "Green" } }
    );
    expect(appendedTrace[0]).toMatchObject({
      step: "Configuration",
      label: "Color",
      source: "Rule: Options (Color = Green)"
    });
  });

  it("only takes configuration prices from Configuration rules", () => {
    const { finalPrice } = applyPriceRules(
      100,
      [
        rule({
          ruleType: "Markup",
          configurationPrices: [{ key: "color", value: "Red", amount: 20 }]
        })
      ],
      { configuration: { color: "Red" } }
    );
    expect(finalPrice).toBe(100);
  });

  it("ignores configuration prices without a configuration", () => {
    const { finalPrice } = applyPriceRules(100, [
      rule({
        ruleType: "Configuration",
        configurationPrices: [{ key: "color", value: "Red", amount: 20 }]
      })
    ]);
    expect(finalPrice).toBe(100);
  });

  it("clamps a price driven negative by credits to zero", () => {
    const { finalPrice } = applyPriceRules(
      10,
      [
        rule({
          ruleType: "Configuration",
          configurationPrices: [{ key: "color", value: "Raw", amount: -25 }]
        })
      ],
      { configuration: { color: "Raw" } }
    );
    expect(finalPrice).toBe(0);
  });

  it("keeps configuration prices under an override that skips rules", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        rule({
          ruleType: "Configuration",
          configurationPrices: [{ key: "color", value: "Red", amount: 20 }]
        }),
        rule({ ruleType: "Discount", amountType: "Percentage", amount: 0.5 }),
        rule({ ruleType: "Markup", amountType: "Fixed", amount: 7 })
      ],
      { configuration: { color: "Red" }, configurationOnly: true }
    );
    expect(finalPrice).toBe(120);
    expect(appendedTrace.map((step) => step.step)).toEqual(["Configuration"]);
  });
});

describe("toMatchedRule", () => {
  const row = {
    id: "pr1",
    name: "Options",
    ruleType: "Configuration" as const,
    amountType: "Fixed" as const,
    amount: 0,
    priority: 0
  };

  it("keeps the well-formed configuration prices of a Configuration rule", () => {
    expect(
      toMatchedRule({
        ...row,
        configurationPrices: [
          { key: "color", value: "Red", amount: 10 },
          { key: "color", value: "Blue" },
          { key: "", value: null, amount: 1 },
          "junk"
        ]
      }).configurationPrices
    ).toEqual([{ key: "color", value: "Red", amount: 10 }]);
  });

  it("reads no configuration prices from any other rule type", () => {
    expect(
      toMatchedRule({
        ...row,
        ruleType: "Markup",
        configurationPrices: [{ key: "color", value: "Red", amount: 10 }]
      }).configurationPrices
    ).toEqual([]);
  });
});

describe("resolveJobConfiguration", () => {
  it("falls back to the quote line's configuration", () => {
    expect(resolveJobConfiguration(null, { color: "Red" })).toEqual({
      configuration: { color: "Red" },
      reconfigured: false
    });
  });

  it("uses the order line's configuration when it matches the quote", () => {
    expect(
      resolveJobConfiguration(
        { length: 10, color: "Red" },
        { color: "Red", length: 10 }
      )
    ).toEqual({
      configuration: { length: 10, color: "Red" },
      reconfigured: false
    });
  });

  it("flags an order line configured differently from its quote", () => {
    expect(
      resolveJobConfiguration({ color: "Blue" }, { color: "Red" })
    ).toEqual({ configuration: { color: "Blue" }, reconfigured: true });
  });

  it("flags an order line configured where the quote was not", () => {
    expect(resolveJobConfiguration({ color: "Blue" }, null)).toEqual({
      configuration: { color: "Blue" },
      reconfigured: true
    });
  });

  it("treats an unset parameter the same whether absent, null or blank", () => {
    expect(
      resolveJobConfiguration(
        { color: "Red", finish: "", coating: null },
        { color: "Red" }
      ).reconfigured
    ).toBe(false);
  });

  it("treats an empty configuration as none", () => {
    expect(resolveJobConfiguration({}, {})).toEqual({
      configuration: null,
      reconfigured: false
    });
  });
});

describe("configuredQuoteBasePrice", () => {
  const configuration = { orbit_regime: "LEO" };
  const defaults = { materialCost: 20, laborCost: 30 };

  it("starts a configured line from the part's sale price", () => {
    expect(
      configuredQuoteBasePrice({
        configuration,
        unitSalePrice: 1800000,
        categoryMarkups: null,
        defaultMarkups: {}
      })
    ).toBe(1800000);
  });

  it("prices an unconfigured line cost-plus", () => {
    expect(
      configuredQuoteBasePrice({
        configuration: null,
        unitSalePrice: 1800000,
        categoryMarkups: null,
        defaultMarkups: {}
      })
    ).toBeNull();
    expect(
      configuredQuoteBasePrice({
        configuration: {},
        unitSalePrice: 1800000,
        categoryMarkups: null,
        defaultMarkups: {}
      })
    ).toBeNull();
  });

  it("prices cost-plus when the part has no sale price", () => {
    for (const unitSalePrice of [null, undefined, 0]) {
      expect(
        configuredQuoteBasePrice({
          configuration,
          unitSalePrice,
          categoryMarkups: null,
          defaultMarkups: {}
        })
      ).toBeNull();
    }
  });

  it("keeps the sale price for a row seeded with the company defaults", () => {
    expect(
      configuredQuoteBasePrice({
        configuration,
        unitSalePrice: 100,
        categoryMarkups: { ...defaults },
        defaultMarkups: defaults
      })
    ).toBe(100);
    expect(
      configuredQuoteBasePrice({
        configuration,
        unitSalePrice: 100,
        categoryMarkups: {},
        defaultMarkups: defaults
      })
    ).toBe(100);
  });

  it("prices cost-plus once someone chose a markup", () => {
    expect(
      configuredQuoteBasePrice({
        configuration,
        unitSalePrice: 100,
        categoryMarkups: { materialCost: 40, laborCost: 40 },
        defaultMarkups: defaults
      })
    ).toBeNull();
    // 0% Markup with no company defaults is still a choice (price at cost).
    expect(
      configuredQuoteBasePrice({
        configuration,
        unitSalePrice: 100,
        categoryMarkups: { materialCost: 0, laborCost: 0 },
        defaultMarkups: {}
      })
    ).toBeNull();
  });
});

describe("withBasePriceSource", () => {
  const trace = [
    { step: "Base Price", source: "Item Unit Sale Price", amount: 100 },
    { step: "Markup", source: "Rule: A", amount: 110, adjustment: 10 },
    { step: "Final Price", source: "Resolved", amount: 110 }
  ];

  it("names the base the row really started from", () => {
    expect(withBasePriceSource(trace, "Cost + Markup")).toEqual([
      { step: "Base Price", source: "Cost + Markup", amount: 100 },
      trace[1],
      trace[2]
    ]);
  });

  it("keeps the trace as resolved when there is no other base", () => {
    expect(withBasePriceSource(trace, null)).toBe(trace);
  });
});

describe("repricedUnitPrice", () => {
  const current = (amount: number) => [
    { step: "Base Price", source: "Cost + Markup", amount: 100 },
    { step: "Final Price", source: "Resolved", amount }
  ];

  it("is null for a manual price, which has no current calculation", () => {
    expect(repricedUnitPrice(null, 110, 2)).toBeNull();
  });

  it("is null when today's price rounds to the stored one", () => {
    expect(repricedUnitPrice(current(110.004), 110, 2)).toBeNull();
  });

  it("is today's price at the line's precision when it differs", () => {
    expect(repricedUnitPrice(current(104.5678), 110, 2)).toBe(104.57);
    expect(repricedUnitPrice(current(104.5678), 110, 4)).toBe(104.5678);
  });
});
