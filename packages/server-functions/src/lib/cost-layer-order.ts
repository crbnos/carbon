// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The order calculateCOGS consumes open FIFO / LIFO cost layers in, with
// serial units relieved from their own layers first (specific
// identification), lives with the relief arithmetic in
// @carbon/database/cost-relief.

export {
  type OrderableCostLayer,
  orderLayersForConsumption
} from "@carbon/database/cost-relief";

// The tracked entities an item's outgoing ledger rows name — the ids to pass
// calculateCOGS as `trackedEntityIds`. Batch ids come along harmlessly: only
// serial layers are ever stamped, so a batch id matches no layer.
export function leavingTrackedEntityIds(
  ledgerRows: readonly {
    itemId?: string | null;
    trackedEntityId?: string | null;
    quantity?: number | null;
  }[],
  itemId: string
): string[] {
  const leaving = new Set<string>();
  for (const row of ledgerRows) {
    if (
      row.itemId === itemId &&
      row.trackedEntityId &&
      (row.quantity ?? 0) < 0
    ) {
      leaving.add(row.trackedEntityId);
    }
  }
  return [...leaving];
}
