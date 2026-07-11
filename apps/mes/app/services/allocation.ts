/**
 * Pure allocation helpers, kept free of the `@carbon/auth` import chain so they
 * can be unit-tested without booting env validation. Re-exported from
 * `inventory.service.ts` for call sites.
 */

export type SuggestedAllocationLot = {
  trackedEntityId: string;
  readableId: string | null;
  quantity: number;
  expirationDate: string | null;
  storageUnitId: string | null;
  storageUnitName: string | null;
};

export type PickMethodSortMethod = "Default" | "FEFO" | "FIFO" | "LIFO";

type SortableLot = {
  createdAt?: string | null;
  expirationDate?: string | null;
};

// String date compare treating null/empty as "largest" (sorts last on ASC).
function cmpNullable(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const av = a ?? "";
  const bv = b ?? "";
  if (av === bv) return 0;
  if (av === "") return 1;
  if (bv === "") return -1;
  return av < bv ? -1 : 1;
}

/**
 * Order lots by the item's pick method — the authoritative ordering for the
 * on-the-fly suggestion. We sort here in TS rather than trusting the RPC's
 * internal ORDER BY because a `LANGUAGE sql` set-returning function is inlined by
 * the planner and its ordering is NOT guaranteed to survive through PostgREST
 * (verified: FIFO's `createdAt`-only order was dropped). Stable + pure.
 *   Default/FEFO → expiration asc (nulls last), then createdAt asc
 *   FIFO         → createdAt asc
 *   LIFO         → createdAt desc
 */
export function sortLotsByPickMethod<T extends SortableLot>(
  lots: T[],
  sortMethod: PickMethodSortMethod
): T[] {
  const sorted = [...lots];
  if (sortMethod === "FIFO") {
    sorted.sort((a, b) => cmpNullable(a.createdAt, b.createdAt));
  } else if (sortMethod === "LIFO") {
    sorted.sort((a, b) => -cmpNullable(a.createdAt, b.createdAt));
  } else {
    // Default / FEFO
    sorted.sort(
      (a, b) =>
        cmpNullable(a.expirationDate, b.expirationDate) ||
        cmpNullable(a.createdAt, b.createdAt)
    );
  }
  return sorted;
}

/**
 * Greedily fill `quantity` from an ordered pool of available lots (the pool must
 * already be in pick order — FEFO/FIFO/LIFO). Takes `min(lot on-hand, remaining)`
 * from each lot, spilling to the next when one is exhausted, and stops once the
 * quantity is covered. Never suggests more than a lot's on-hand. Pure + total.
 */
export function greedyFillAllocation(
  pool: Array<{
    trackedEntityId: string;
    readableId: string | null;
    availableQuantity: number;
    expirationDate?: string | null;
    storageUnitId?: string | null;
    storageUnitName?: string | null;
  }>,
  quantity: number
): SuggestedAllocationLot[] {
  const picks: SuggestedAllocationLot[] = [];
  let remaining = quantity;
  for (const lot of pool) {
    if (remaining <= 0) break;
    const available = Number(lot.availableQuantity ?? 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    picks.push({
      trackedEntityId: lot.trackedEntityId,
      readableId: lot.readableId,
      quantity: take,
      expirationDate: lot.expirationDate ?? null,
      storageUnitId: lot.storageUnitId ?? null,
      storageUnitName: lot.storageUnitName ?? null
    });
    remaining -= take;
  }
  return picks;
}
