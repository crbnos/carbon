// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type PurchaseLineItemTerms,
  purchaseQuantityOfItem,
  suggestedUnitPrice
} from "./purchase-line";

const terms = (
  over: Partial<PurchaseLineItemTerms> = {}
): PurchaseLineItemTerms => ({
  conversionFactor: 1,
  minimumOrderQuantity: 0,
  inventoryUnit: "EA",
  purchaseUnit: "EA",
  unitCost: 12,
  pricing: null,
  ...over
});
const usd = { currencyCode: "USD", exchangeRate: 1 };
const pricing = (
  supplierUnitPrice: number | null,
  breaks = [] as number[][]
) => ({
  supplierUnitPrice,
  currency: usd,
  priceBreaks: breaks.map(([quantity, price]) => ({
    quantity: quantity!,
    supplierUnitPrice: price!
  }))
});

describe("purchaseQuantityOfItem", () => {
  it("converts the item's unit to purchase units", () => {
    expect(purchaseQuantityOfItem(terms({ conversionFactor: 10 }), 30)).toBe(3);
  });
  it("raises the quantity to the minimum order", () => {
    expect(purchaseQuantityOfItem(terms({ minimumOrderQuantity: 5 }), 2)).toBe(
      5
    );
  });
});

describe("suggestedUnitPrice", () => {
  it("takes the supplier's price", () => {
    expect(
      suggestedUnitPrice(terms({ pricing: pricing(50) }), 1, usd, "USD")
    ).toBe(50);
  });
  it("finds the price break by purchase quantity, not the item's quantity", () => {
    const withBreak = terms({
      conversionFactor: 10,
      pricing: pricing(50, [[3, 40]])
    });
    expect(suggestedUnitPrice(withBreak, 20, usd, "USD")).toBe(50);
    expect(suggestedUnitPrice(withBreak, 30, usd, "USD")).toBe(40);
  });
  it("falls back to the unit cost in the order's currency", () => {
    const eur = { currencyCode: "EUR", exchangeRate: 0.5 };
    expect(suggestedUnitPrice(terms(), 1, usd, "USD")).toBe(12);
    expect(suggestedUnitPrice(terms(), 1, eur, "USD")).toBe(6);
  });
  it("costs the fallback per purchase unit", () => {
    expect(
      suggestedUnitPrice(terms({ conversionFactor: 10 }), 10, usd, "USD")
    ).toBe(120);
  });
});
