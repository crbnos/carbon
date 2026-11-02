// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type PlanningQuantityLine,
  planningQuantityChange
} from "../app/modules/purchasing/purchasing.models";

// 2.00 a purchase unit, 10 inventory units per purchase unit, 10% tax.
const base = (
  overrides: Partial<PlanningQuantityLine> = {}
): PlanningQuantityLine => ({
  supplierUnitPrice: 2,
  supplierShippingCost: 0,
  purchaseQuantity: 4,
  quantityReceived: 0,
  quantityInvoiced: 0,
  receivedComplete: false,
  taxPercent: 0.1,
  supplierTaxAmount: 0.8,
  conversionFactor: 10,
  currencyCode: "USD",
  baseCurrencyCode: "USD",
  ...overrides
});

const decimals = new Map([
  ["USD", 2],
  ["JPY", 0]
]);

describe("planningQuantityChange", () => {
  // 55 inventory units at 10 per purchase unit is 5.5 → 6; tax 2 × 6 × 10% = 1.20.
  it("converts to whole purchase units and restates the tax pair", () => {
    expect(planningQuantityChange(base(), decimals, 55)).toEqual({
      ok: true,
      quantity: 6,
      percent: 0.1,
      amount: 1.2,
      receivedComplete: false,
      invoicedComplete: false
    });
  });

  // The suggestion is what the line still has to bring: 6 to come on top of
  // the 2 received is 8; tax 2 × 8 × 10% = 1.60.
  it("adds what was already received to the quantity still to come", () => {
    expect(
      planningQuantityChange(base({ quantityReceived: 2 }), decimals, 55)
    ).toMatchObject({ ok: true, quantity: 8, amount: 1.6 });
  });

  it("marks the line received when nothing more is to come", () => {
    expect(
      planningQuantityChange(base({ quantityReceived: 6 }), decimals, 0)
    ).toMatchObject({ ok: true, quantity: 6, receivedComplete: true });
  });

  // 1.1 / 0.1 is 11.000000000000002 in floating point; a bare ceil makes 12.
  it("does not round float noise up a whole purchase unit", () => {
    expect(
      planningQuantityChange(base({ conversionFactor: 0.1 }), decimals, 1.1)
    ).toMatchObject({ ok: true, quantity: 11 });
  });

  it("treats a line with no conversion factor as one to one", () => {
    expect(
      planningQuantityChange(base({ conversionFactor: null }), decimals, 5)
    ).toMatchObject({ ok: true, quantity: 5 });
  });

  // A PO with no currency is in the company's base currency. JPY has no
  // minor unit: 2 × 6 × 10% = 1.2 rounds to 1.
  it("prices a PO with no currency in the company's base currency", () => {
    expect(
      planningQuantityChange(
        base({ currencyCode: null, baseCurrencyCode: "JPY" }),
        decimals,
        55
      )
    ).toMatchObject({ ok: true, quantity: 6, amount: 1 });
  });

  it.each([
    ["the line was not found", undefined],
    ["its currency has no precision", base({ currencyCode: "XTS" })],
    [
      "it has no currency at all",
      base({ currencyCode: null, baseCurrencyCode: null })
    ]
  ])("cannot compute a change when %s", (_label, line) => {
    expect(planningQuantityChange(line, decimals, 55).ok).toBe(false);
  });
});
