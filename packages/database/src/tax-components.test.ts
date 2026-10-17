// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SCALE } from "./precision.ts";
import {
  effectiveComponents,
  effectiveTaxPercent,
  lineTaxBase,
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
