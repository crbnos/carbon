// The order calculateCOGS consumes open FIFO / LIFO cost layers in, kept pure
// so it can be tested without a database.
//
// Specific identification for serial units: a layer booked for ONE serial
// (`trackedEntityId` set, e.g. a fixed asset returned to stock at its net book
// value) belongs to that unit. The unit leaving is relieved from its own layer
// first; every other consumer takes the unstamped layers in FIFO / LIFO order
// and reaches a layer stamped for a DIFFERENT unit only when the unstamped
// ones run out — relieving another unit's value beats relieving value that
// isn't on the books, but it is the last resort.

export interface OrderableCostLayer {
  trackedEntityId: string | null;
}

export function orderLayersForConsumption<T extends OrderableCostLayer>(
  // Already in FIFO / LIFO order.
  layers: T[],
  trackedEntityIds: readonly string[] = []
): T[] {
  const leaving = new Set(trackedEntityIds);
  const own: T[] = [];
  const unstamped: T[] = [];
  const others: T[] = [];
  for (const layer of layers) {
    if (layer.trackedEntityId === null) unstamped.push(layer);
    else if (leaving.has(layer.trackedEntityId)) own.push(layer);
    else others.push(layer);
  }
  return [...own, ...unstamped, ...others];
}

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
    if (row.itemId === itemId && row.trackedEntityId && (row.quantity ?? 0) < 0) {
      leaving.add(row.trackedEntityId);
    }
  }
  return [...leaving];
}
