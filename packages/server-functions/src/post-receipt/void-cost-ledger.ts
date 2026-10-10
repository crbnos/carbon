// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What voiding a purchase receipt does to the cost layers its posting wrote.

import { EPSILON } from "@carbon/utils";

export type ReceiptCostLedgerRow = {
  id: string;
  itemId: string | null;
  quantity: number;
  remainingQuantity: number;
  cost: number;
  supplierId: string | null;
  trackedEntityId: string | null;
};

export type RestoringLayer = {
  itemId: string | null;
  quantity: number;
  cost: number;
  supplierId: string | null;
  trackedEntityId: string | null;
};

export type ReceiptVoidCostLedgerPlan = {
  consumed: boolean;
  layerIdsToClose: string[];
  restoringLayers: RestoringLayer[];
};

// A positive row is a layer the receipt created: the void closes it, unless
// part of it was already issued or shipped — that stock has moved on, so the
// void is refused (as the sales return void is) and the remainder is an
// inventory adjustment. A negative row is what a negative line relieved from
// older layers: the void puts that stock back as a new layer at the cost that
// was relieved, the cost the reversing journal credits back to inventory.
export function planReceiptVoidCostLedger(
  rows: ReceiptCostLedgerRow[]
): ReceiptVoidCostLedgerPlan {
  const created = rows.filter((row) => row.quantity > 0);
  const relieved = rows.filter((row) => row.quantity < 0);

  return {
    consumed: created.some(
      (row) => row.quantity - row.remainingQuantity > EPSILON
    ),
    layerIdsToClose: created.map((row) => row.id),
    restoringLayers: relieved.map((row) => ({
      itemId: row.itemId,
      quantity: -row.quantity,
      cost: -row.cost,
      supplierId: row.supplierId,
      trackedEntityId: row.trackedEntityId
    }))
  };
}
