// Pure cost resolver for Unscrap: given the ORIGINAL scrap movement's
// costLedger rows (linked via costLedger.documentId = the scrap itemLedger id),
// return the unit cost the restored layer must book at so a scrap→unscrap
// round trip nets zero P&L (Oracle Return-from-Scrap precedent). Returns null
// when the rows can't yield a cost — the caller then falls back to current
// cost. No imports so `deno test` type-checks clean.

export function resolveUnscrapUnitCost(
  rows: Array<{ quantity: number; cost: number }>
): number | null {
  if (rows.length === 0) return null;
  let totalQuantity = 0;
  let totalCost = 0;
  for (const row of rows) {
    totalQuantity += Math.abs(Number(row.quantity) || 0);
    totalCost += Math.abs(Number(row.cost) || 0);
  }
  if (totalQuantity === 0) return null;
  return totalCost / totalQuantity;
}
