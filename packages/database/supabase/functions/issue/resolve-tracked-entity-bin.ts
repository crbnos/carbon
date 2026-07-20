// The storage unit where a tracked entity currently holds stock, derived from
// its item-ledger rows by net on-hand per bin. Pure — no DB, no I/O — so it is
// unit-testable with `deno test`.
//
// A picked entity has ledger rows in BOTH its source and lineside bins;
// consumption/split entries must be booked against the bin that actually holds
// the stock (the lineside bin after a pick), NOT an arbitrary row. Selecting
// `.find(...)?.storageUnitId` off a `createdBy`-ordered list grabs a wrong bin
// and produces a per-bin-negative ledger. Returns the bin with the highest
// positive net; falls back to any bin the entity appears in when nothing nets
// positive.

export type BinLedgerRow = {
  trackedEntityId: string | null;
  storageUnitId: string | null;
  quantity: number | string | null;
};

export function resolveTrackedEntityBin(
  ledgers: BinLedgerRow[],
  trackedEntityId: string
): string | null {
  const netByBin = new Map<string, number>();
  for (const l of ledgers) {
    if (l.trackedEntityId !== trackedEntityId || !l.storageUnitId) continue;
    netByBin.set(
      l.storageUnitId,
      (netByBin.get(l.storageUnitId) ?? 0) + Number(l.quantity ?? 0)
    );
  }
  let bestBin: string | null = null;
  let bestQty = 0;
  for (const [bin, qty] of netByBin) {
    if (qty > bestQty) {
      bestQty = qty;
      bestBin = bin;
    }
  }
  if (bestBin) return bestBin;
  return (
    ledgers.find(
      (l) => l.trackedEntityId === trackedEntityId && l.storageUnitId
    )?.storageUnitId ?? null
  );
}
