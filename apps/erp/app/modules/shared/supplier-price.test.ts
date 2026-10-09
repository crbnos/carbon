// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// shared.service's graph loads @carbon/content/glossary, whose module-load
// Lingui `msg` macro is not transformed under plain vitest. The pure function
// under test needs none of it.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { resolveSupplierPrice } = await import("./shared.service");

const EUR_PART = {
  priceBreaks: [
    { quantity: 1, supplierUnitPrice: 10 },
    { quantity: 100, supplierUnitPrice: 8 }
  ],
  supplierUnitPrice: 12,
  currency: { currencyCode: "EUR", exchangeRate: 0.8 }
};

describe("resolveSupplierPrice", () => {
  it("puts a price on an order in the supplier's currency exactly as quoted", () => {
    const order = { currencyCode: "EUR", exchangeRate: 0.75 };
    expect(resolveSupplierPrice(EUR_PART, 150, order, 0)).toBe(8);
  });

  it("converts a foreign price onto a base-currency order at the current rate", () => {
    const order = { currencyCode: "USD", exchangeRate: 1 };
    // 8 EUR at 0.8 EUR per USD
    expect(resolveSupplierPrice(EUR_PART, 150, order, 0)).toBe(10);
  });

  it("crosses through base onto an order in a third currency", () => {
    const order = { currencyCode: "GBP", exchangeRate: 0.5 };
    // 10 EUR = 12.5 USD = 6.25 GBP
    expect(resolveSupplierPrice(EUR_PART, 5, order, 0)).toBe(6.25);
  });

  it("uses the document fallback when the part has no price for the quantity", () => {
    const order = { currencyCode: "USD", exchangeRate: 1 };
    const noPrice = { ...EUR_PART, priceBreaks: [], supplierUnitPrice: null };
    expect(resolveSupplierPrice(noPrice, 5, order, 3.5)).toBe(3.5);
    expect(resolveSupplierPrice(null, 5, order, 3.5)).toBe(3.5);
  });
});
