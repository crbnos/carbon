// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A supplier part's price is stored as the supplier quoted it:
// `supplierUnitPrice` per PURCHASE unit, in the part's `currencyCode` (NULL =
// the company base currency). Price breaks (`supplierPartPrice`) share the
// part's currency and are keyed by PURCHASE quantity.
//
// Nothing stores a converted copy. Every reader converts at the CURRENT rate
// when it uses the price, through this module:
//  - a purchase document (order, invoice) wants it in the DOCUMENT's currency
//    → `convertUnitPrice`;
//  - quote costing wants base currency per INVENTORY unit
//    → `buildSupplierPriceMap`.
//
// Rates are foreign-per-base ("units of the currency per 1 unit of the
// company's base currency"), the convention every document header stamps.

import { assertExchangeRate } from "./accounting-currency.ts";
import { round } from "./precision.ts";

/** A currency and its rate: units of `currencyCode` per 1 base unit. */
export type CurrencyRate = {
  currencyCode: string;
  exchangeRate: number;
};

/**
 * Convert a per-unit price from one currency to another through the company
 * base. The same code on both sides returns the price untouched — no FX round
 * trip, so a EUR price lands on a EUR order exactly as quoted.
 */
export function convertUnitPrice(
  price: number,
  from: CurrencyRate,
  to: CurrencyRate
): number {
  if (from.currencyCode === to.currencyCode) return price;
  assertExchangeRate(from.exchangeRate);
  assertExchangeRate(to.exchangeRate);
  return round((price / from.exchangeRate) * to.exchangeRate);
}

export type SupplierPriceBreak = {
  quantity: number;
  supplierUnitPrice: number;
};

/**
 * The supplier's price for a purchase quantity, in the part's own currency:
 * the highest break at or below the quantity, else the part's price.
 */
export function supplierPriceForQuantity(
  priceBreaks: SupplierPriceBreak[],
  quantity: number,
  fallbackUnitPrice: number | null
): number | null {
  let best: SupplierPriceBreak | null = null;
  for (const pb of priceBreaks) {
    if (pb.quantity <= quantity && (!best || pb.quantity > best.quantity)) {
      best = pb;
    }
  }
  return best ? best.supplierUnitPrice : fallbackUnitPrice;
}

/** The currency a supplier part's price is in; NULL predates the column. */
export function supplierPartCurrency(
  currencyCode: string | null | undefined,
  baseCurrencyCode: string
): string {
  return currencyCode ?? baseCurrencyCode;
}

export type SupplierPartPricing = {
  itemId: string;
  currencyCode: string | null;
  conversionFactor: number | null;
  supplierUnitPrice: number | null;
  priceBreaks: SupplierPriceBreak[];
};

/** A costing break: INVENTORY quantity and base-currency price per inventory unit. */
export type BuyPriceBreak = {
  quantity: number;
  unitPrice: number;
};

export type SupplierPriceMap = Record<
  string,
  {
    priceBreaks: BuyPriceBreak[];
    fallbackUnitPrice: number | null;
  }
>;

/**
 * Pool every supplier's pricing per item for quote costing, in base currency
 * per INVENTORY unit with break quantities in inventory units — the basis a
 * quote's bill of materials is costed on. Each supplier part is converted at
 * its own currency's current rate, so suppliers quoting in different
 * currencies compare on one basis. A part whose currency has no rate is left
 * out rather than costed at par.
 *
 * @param exchangeRates foreign-per-base rate by currency code
 */
export function buildSupplierPriceMap(
  parts: SupplierPartPricing[],
  exchangeRates: Record<string, number | null | undefined>,
  baseCurrencyCode: string
): SupplierPriceMap {
  const result: SupplierPriceMap = {};

  for (const part of parts) {
    const code = supplierPartCurrency(part.currencyCode, baseCurrencyCode);
    const rate = code === baseCurrencyCode ? 1 : exchangeRates[code];
    if (!rate || !Number.isFinite(rate) || rate <= 0) continue;

    const factor =
      part.conversionFactor && part.conversionFactor > 0
        ? part.conversionFactor
        : 1;
    const toInventoryBase = (price: number) => price / rate / factor;

    const entry = (result[part.itemId] ??= {
      priceBreaks: [],
      fallbackUnitPrice: null
    });

    if (part.supplierUnitPrice != null) {
      const price = toInventoryBase(part.supplierUnitPrice);
      if (entry.fallbackUnitPrice === null || price < entry.fallbackUnitPrice) {
        entry.fallbackUnitPrice = price;
      }
    }

    for (const pb of part.priceBreaks) {
      entry.priceBreaks.push({
        quantity: pb.quantity * factor,
        unitPrice: toInventoryBase(pb.supplierUnitPrice)
      });
    }
  }

  for (const entry of Object.values(result)) {
    entry.priceBreaks.sort((a, b) => a.quantity - b.quantity);
  }

  return result;
}
