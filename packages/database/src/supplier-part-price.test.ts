// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildSupplierPriceMap,
  convertUnitPrice,
  supplierPriceForQuantity
} from "./supplier-part-price.ts";

const USD = { currencyCode: "USD", exchangeRate: 1 };
const EUR = { currencyCode: "EUR", exchangeRate: 0.8 };
const GBP = { currencyCode: "GBP", exchangeRate: 0.5 };

describe("convertUnitPrice", () => {
  it("returns a price in the same currency untouched", () => {
    expect(
      convertUnitPrice(1.23456789, EUR, { ...EUR, exchangeRate: 0.7 })
    ).toBe(1.23456789);
  });

  it("divides into base", () => {
    expect(convertUnitPrice(8, EUR, USD)).toBe(10);
  });

  it("multiplies out of base", () => {
    expect(convertUnitPrice(10, USD, EUR)).toBe(8);
  });

  it("crosses through base between two foreign currencies", () => {
    // 8 EUR = 10 USD = 5 GBP
    expect(convertUnitPrice(8, EUR, GBP)).toBe(5);
  });

  it("refuses an unusable rate rather than converting at par", () => {
    expect(() =>
      convertUnitPrice(8, { currencyCode: "EUR", exchangeRate: 0 }, USD)
    ).toThrow();
  });
});

describe("supplierPriceForQuantity", () => {
  const breaks = [
    { quantity: 1, supplierUnitPrice: 10 },
    { quantity: 100, supplierUnitPrice: 8 },
    { quantity: 50, supplierUnitPrice: 9 }
  ];

  it("takes the highest break at or below the quantity", () => {
    expect(supplierPriceForQuantity(breaks, 75, 12)).toBe(9);
    expect(supplierPriceForQuantity(breaks, 100, 12)).toBe(8);
  });

  it("falls back to the part's price below every break", () => {
    expect(supplierPriceForQuantity(breaks, 0.5, 12)).toBe(12);
    expect(supplierPriceForQuantity([], 5, null)).toBeNull();
  });
});

describe("buildSupplierPriceMap", () => {
  it("costs per inventory unit in base, with break quantities in inventory units", () => {
    // A box of 10 for 8 EUR = 10 USD = 1 USD each.
    const map = buildSupplierPriceMap(
      [
        {
          itemId: "item",
          currencyCode: "EUR",
          conversionFactor: 10,
          supplierUnitPrice: 8,
          priceBreaks: [{ quantity: 5, supplierUnitPrice: 4 }]
        }
      ],
      { EUR: 0.8 },
      "USD"
    );
    expect(map.item).toEqual({
      fallbackUnitPrice: 1,
      priceBreaks: [{ quantity: 50, unitPrice: 0.5 }]
    });
  });

  it("reads a part with no currency as base", () => {
    const map = buildSupplierPriceMap(
      [
        {
          itemId: "item",
          currencyCode: null,
          conversionFactor: 1,
          supplierUnitPrice: 3,
          priceBreaks: []
        }
      ],
      {},
      "USD"
    );
    expect(map.item?.fallbackUnitPrice).toBe(3);
  });

  it("compares suppliers in different currencies on one basis", () => {
    const map = buildSupplierPriceMap(
      [
        {
          itemId: "item",
          currencyCode: "USD",
          conversionFactor: 1,
          supplierUnitPrice: 9,
          priceBreaks: []
        },
        {
          itemId: "item",
          currencyCode: "GBP",
          conversionFactor: 1,
          // 4 GBP = 8 USD, cheaper than the 9 USD supplier
          supplierUnitPrice: 4,
          priceBreaks: []
        }
      ],
      { GBP: 0.5 },
      "USD"
    );
    expect(map.item?.fallbackUnitPrice).toBe(8);
  });

  it("leaves out a part whose currency has no rate", () => {
    const map = buildSupplierPriceMap(
      [
        {
          itemId: "item",
          currencyCode: "JPY",
          conversionFactor: 1,
          supplierUnitPrice: 100,
          priceBreaks: [{ quantity: 1, supplierUnitPrice: 90 }]
        }
      ],
      { JPY: null },
      "USD"
    );
    expect(map.item).toBeUndefined();
  });
});
