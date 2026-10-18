// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SCALE } from "./precision.ts";
import {
  effectiveComponents,
  effectiveTaxPercent,
  groupByTaxRate,
  lineTaxBase,
  memoAmounts,
  receiptUnitCost,
  splitLineTax,
  type TaxComponentInput
} from "./tax-components.ts";

function component(
  overrides: Partial<TaxComponentInput> = {}
): TaxComponentInput {
  return {
    id: "c1",
    name: "VAT",
    taxAuthorityId: null,
    taxPercent: 0.2,
    recoverablePercent: 0,
    sequence: 1,
    isCompound: false,
    taxReceivedAccountId: null,
    taxPaidAccountId: null,
    effectiveDate: null,
    expirationDate: null,
    ...overrides
  };
}

describe("effectiveComponents", () => {
  const code = {
    components: [
      component({
        id: "old",
        taxPercent: 0.0825,
        expirationDate: "2026-06-30"
      }),
      component({
        id: "new",
        taxPercent: 0.085,
        effectiveDate: "2026-07-01"
      })
    ]
  };

  it("picks the component in force on each side of a rate change", () => {
    expect(effectiveComponents(code, "2026-06-30").map((c) => c.id)).toEqual([
      "old"
    ]);
    expect(effectiveComponents(code, "2026-07-01").map((c) => c.id)).toEqual([
      "new"
    ]);
  });

  it("orders components by sequence", () => {
    const ordered = effectiveComponents(
      {
        components: [
          component({ id: "city", sequence: 2 }),
          component({ id: "state", sequence: 1 })
        ]
      },
      "2026-10-16"
    );
    expect(ordered.map((c) => c.id)).toEqual(["state", "city"]);
  });
});

describe("effectiveTaxPercent", () => {
  it("adds simple components", () => {
    expect(
      effectiveTaxPercent([
        component({ taxPercent: 0.0625 }),
        component({ id: "c2", taxPercent: 0.02, sequence: 2 })
      ])
    ).toBeCloseTo(0.0825, 10);
  });

  it("compounds a component on the earlier tax", () => {
    expect(
      effectiveTaxPercent([
        component({ taxPercent: 0.05 }),
        component({
          id: "pst",
          taxPercent: 0.09975,
          sequence: 2,
          isCompound: true
        })
      ])
    ).toBeCloseTo(0.05 + 0.09975 * 1.05, 10);
  });
});

describe("splitLineTax", () => {
  it("splits a 50% recoverable component into two equal shares", () => {
    const [part] = splitLineTax({
      base: 1000,
      lineTax: 200,
      components: [component({ recoverablePercent: 0.5 })],
      scale: SCALE
    });
    expect(part).toMatchObject({
      taxAmount: 200,
      recoverableAmount: 100,
      nonRecoverableAmount: 100
    });
  });

  it("keeps the parts summing to the line tax", () => {
    const parts = splitLineTax({
      base: 33.33,
      lineTax: 2.89,
      components: [
        component({ id: "a", taxPercent: 0.0625 }),
        component({ id: "b", taxPercent: 0.01, sequence: 2 }),
        component({ id: "c", taxPercent: 0.0125, sequence: 3 })
      ],
      scale: 2
    });
    const sum = parts.reduce((total, p) => total + p.taxAmount, 0);
    expect(sum).toBeCloseTo(2.89, 10);
    for (const p of parts) {
      expect(p.recoverableAmount + p.nonRecoverableAmount).toBeCloseTo(
        p.taxAmount,
        10
      );
    }
  });

  it("apportions a supplier's tax that differs from base × rate", () => {
    const parts = splitLineTax({
      base: 1000,
      lineTax: 199.99,
      components: [
        component({ id: "a", taxPercent: 0.1, recoverablePercent: 1 }),
        component({ id: "b", taxPercent: 0.1, sequence: 2 })
      ],
      scale: 2
    });
    expect(parts.reduce((t, p) => t + p.taxAmount, 0)).toBeCloseTo(199.99, 10);
  });

  it("returns nothing for a line with no components", () => {
    expect(
      splitLineTax({ base: 100, lineTax: 8, components: [], scale: SCALE })
    ).toEqual([]);
  });
});

describe("lineTaxBase", () => {
  const args = {
    merchandise: 100,
    addOnCost: 20,
    shippingCost: 10,
    allocatedHeaderShipping: 5
  };

  it("leaves header shipping out unless the code taxes shipping", () => {
    expect(lineTaxBase({ ...args, taxesShipping: false })).toBe(130);
    expect(lineTaxBase({ ...args, taxesShipping: true })).toBe(135);
  });
});

describe("receiptUnitCost", () => {
  const args = {
    unitPrice: 100,
    conversionFactor: 1,
    purchaseQuantity: 10,
    taxAmount: 200,
    shippingCost: 30
  };

  it("matches the historical formula with no recoverable tax", () => {
    expect(receiptUnitCost({ ...args, recoverableTaxAmount: 0 })).toBe(
      100 + (200 + 30) / 10
    );
  });

  it("leaves fully recoverable tax out of the unit cost", () => {
    expect(receiptUnitCost({ ...args, recoverableTaxAmount: 200 })).toBe(
      100 + 30 / 10
    );
  });

  it("converts purchase units to inventory units", () => {
    expect(
      receiptUnitCost({
        ...args,
        conversionFactor: 2,
        recoverableTaxAmount: 0
      })
    ).toBe(100 / 2 + 230 / 20);
  });
});

describe("groupByTaxRate", () => {
  const row = (id: string, taxCodeId: string | null, taxPercent: number) => ({
    id,
    taxCodeId,
    taxPercent
  });

  it("makes one group per code, in the order of each group's first row", () => {
    const groups = groupByTaxRate(
      [
        row("a", "uk-standard", 0.2),
        row("b", "uk-reduced", 0.05),
        row("c", "uk-standard", 0.2)
      ],
      (r) => r
    );
    expect(
      groups.map((g) => [g.taxCodeId, g.taxPercent, g.rows.map((r) => r.id)])
    ).toEqual([
      ["uk-standard", 0.2, ["a", "c"]],
      ["uk-reduced", 0.05, ["b"]]
    ]);
  });

  it("splits one code at two rates, as a component that started mid-term does", () => {
    const groups = groupByTaxRate(
      [row("sep", "vat", 0.1), row("oct", "vat", 0.15)],
      (r) => r
    );
    expect(groups.map((g) => g.taxPercent)).toEqual([0.1, 0.15]);
  });

  it("groups lines with no code by their bare percent, apart from coded lines at the same rate", () => {
    const groups = groupByTaxRate(
      [
        row("a", null, 0.0825),
        row("b", null, 0.0825),
        row("c", null, 0),
        row("d", "tx", 0.0825)
      ],
      (r) => r
    );
    expect(
      groups.map((g) => [g.taxCodeId, g.taxPercent, g.rows.map((r) => r.id)])
    ).toEqual([
      [null, 0.0825, ["a", "b"]],
      [null, 0, ["c"]],
      ["tx", 0.0825, ["d"]]
    ]);
  });

  it("treats float noise in a rate as the same rate", () => {
    const groups = groupByTaxRate(
      [row("a", null, 0.1 + 0.2), row("b", null, 0.3)],
      (r) => r
    );
    expect(groups).toHaveLength(1);
  });
});

describe("memoAmounts", () => {
  it("computes the tax forward from the net and stores the gross", () => {
    expect(memoAmounts(1000, 0.2, 2)).toEqual({
      netAmount: 1000,
      taxAmount: 200,
      amount: 1200
    });
  });

  it("rounds the net, then the tax on the rounded net, at the currency's decimals", () => {
    // 33.335 → 33.34 (half up); 33.34 × 8.25% = 2.75055 → 2.75.
    expect(memoAmounts(33.335, 0.0825, 2)).toEqual({
      netAmount: 33.34,
      taxAmount: 2.75,
      amount: 36.09
    });
  });

  it("settles a zero-decimal currency in whole units", () => {
    expect(memoAmounts(1001, 0.1, 0)).toEqual({
      netAmount: 1001,
      taxAmount: 100,
      amount: 1101
    });
  });

  it("carries no tax at a zero rate", () => {
    expect(memoAmounts(250.5, 0, 2)).toEqual({
      netAmount: 250.5,
      taxAmount: 0,
      amount: 250.5
    });
  });
});
