// Client-safe pricing helpers. Pure functions — no auth, no DB, no ALS.
// Browser components import from here; server callers may keep using the
// re-exports from shared.service.server. Restored to match `main` so that
// UI bundles do not pull in server-only modules.

import type { PriceBreak, SupplierPriceMap } from "./shared.models";

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

export function resolveSupplierPrice(
  priceBreaks: PriceBreak[],
  quantity: number,
  fallbackUnitPrice: number,
  exchangeRate: number
): number {
  if (!priceBreaks.length) return fallbackUnitPrice;
  return (
    lookupPriceFromBreaks(
      priceBreaks,
      quantity,
      fallbackUnitPrice * exchangeRate
    ) / exchangeRate
  );
}
