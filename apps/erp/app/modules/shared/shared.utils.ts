// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type CurrencyRate,
  convertUnitPrice,
  supplierPriceForQuantity
} from "@carbon/database/supplier-part-price";
import type {
  PriceBreak,
  SupplierPartPricing,
  SupplierPriceMap
} from "./shared.models";

/**
 * Core sync lookup: given price break tiers and a requested quantity,
 * return the unit price from the highest qualifying tier
 * (where tier.quantity <= requestedQty). Falls back to fallbackPrice.
 */
export function lookupPriceFromBreaks(
  priceBreaks: PriceBreak[],
  requestedQty: number,
  fallbackPrice: number
): number {
  const eligible = priceBreaks.filter((pb) => pb.quantity <= requestedQty);
  if (eligible.length) {
    return eligible.reduce((best, pb) =>
      pb.quantity > best.quantity ? pb : best
    ).unitPrice;
  }
  return fallbackPrice;
}

/**
 * Map-aware wrapper: look up itemId in a SupplierPriceMap, then resolve
 * via lookupPriceFromBreaks. Used by useLineCosts for BOM tree costing.
 */
export function lookupBuyPriceFromMap(
  itemId: string,
  requestedQty: number,
  priceMap: SupplierPriceMap,
  fallbackCost: number
): number {
  const entry = priceMap[itemId];
  if (!entry) return fallbackCost;
  return lookupPriceFromBreaks(
    entry.priceBreaks,
    requestedQty,
    entry.fallbackUnitPrice ?? fallbackCost
  );
}

/**
 * What a "Purchase to Order" quote material's unit cost IS: a typed cost wins,
 * anything else re-resolves from supplier price breaks. Every reader of a
 * bought-to-order cost must go through this — reaching for
 * lookupBuyPriceFromMap directly silently ignores a typed cost.
 *
 * Mirrored in `packages/database/src/methods.ts`.
 */
export function resolveBuyUnitCost(
  material: {
    itemId: string;
    unitCost: number;
    unitCostSource?: string | null;
  },
  requestedQty: number,
  priceMap: SupplierPriceMap
): number {
  if (material.unitCostSource === "manual") return material.unitCost;
  return lookupBuyPriceFromMap(
    material.itemId,
    requestedQty,
    priceMap,
    material.unitCost
  );
}

/**
 * Resolve the supplier unit price for a purchase quantity, in the DOCUMENT's
 * currency — what a purchase order or invoice line's `supplierUnitPrice` holds.
 *
 * The supplier part's breaks and price are in its own currency, per purchase
 * unit. A part in the document's currency lands as quoted; any other converts
 * through base at the part currency's current rate and the document's rate
 * (`convertUnitPrice`). With no supplier price for the quantity the
 * `documentFallbackPrice` (already in the document's currency) is used.
 *
 * @param document the document's currency and its exchange rate (foreign per base)
 */
export function resolveSupplierPrice(
  pricing: SupplierPartPricing | null,
  quantity: number,
  document: CurrencyRate,
  documentFallbackPrice: number
): number {
  const supplierPrice = pricing
    ? supplierPriceForQuantity(
        pricing.priceBreaks,
        quantity,
        pricing.supplierUnitPrice
      )
    : null;
  if (supplierPrice === null || !pricing) return documentFallbackPrice;
  return convertUnitPrice(supplierPrice, pricing.currency, document);
}
