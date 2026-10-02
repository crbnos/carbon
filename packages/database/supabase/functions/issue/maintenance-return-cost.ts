// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure resolver for a spare part returned from a maintenance dispatch: how much
// of the return carries value, and at what unit cost.
//
// A return reverses what the dispatch actually expensed, so it reads the
// dispatch's own 'Maintenance Consumption' cost-ledger rows for the item
// (signed: issues negative, earlier returns positive) and books at their
// blended issue cost — a round trip nets zero P&L. Only the quantity still
// expensed (issued minus already returned) is valued: an issue posted before
// maintenance consumption carried value has no cost row, so returning it must
// not credit an expense that was never debited. Returns null when nothing is
// left to reverse — the caller writes the ledger row alone. No imports so
// `deno test` type-checks clean.

const EPSILON = 1e-6;

export function resolveMaintenanceReturnCost(
  rows: Array<{ quantity: number; cost: number }>,
  returnQuantity: number
): { quantity: number; unitCost: number } | null {
  let issuedQuantity = 0;
  let issuedCost = 0;
  let returnedQuantity = 0;
  for (const row of rows) {
    const quantity = Number(row.quantity) || 0;
    if (quantity < 0) {
      issuedQuantity += -quantity;
      issuedCost += Math.abs(Number(row.cost) || 0);
    } else {
      returnedQuantity += quantity;
    }
  }

  const outstanding = issuedQuantity - returnedQuantity;
  const quantity = Math.min(Math.abs(returnQuantity), outstanding);
  if (issuedQuantity < EPSILON || quantity < EPSILON) return null;

  return { quantity, unitCost: issuedCost / issuedQuantity };
}
