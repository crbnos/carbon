// Pure cost resolver for sales-return receipts: given the ORIGINAL outbound
// shipment's costLedger consumption rows for the returned item (linked via
// costLedger.documentId = the shipment id, documentType 'Sales Shipment'),
// return the unit cost the re-entry layer must book at so a ship→return round
// trip nets zero P&L (BC exact cost reversing). Consumption rows are per
// (shipment, item) — post-shipment aggregates across lines — so the average is
// the best obtainable original cost. Returns null when the rows can't yield a
// cost — the caller then falls back to current cost (flagged-variance path).
// Same math as resolveUnscrapUnitCost (post-inventory-adjustment), kept as its
// own named contract in shared/ because the two flows evolve independently.
// No imports so `deno test` type-checks clean.

export function resolveReturnUnitCost(
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
