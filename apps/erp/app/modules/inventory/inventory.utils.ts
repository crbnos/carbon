// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getItemStorageUnitQuantities } from "../items/items.utils";

/** A lineage depth the traceability graph walks: 1 to 5 hops. */
export function clampDepth(n: number): number {
  return Math.min(Math.max(1, n), 5);
}

export async function getReceiptTracking(
  client: SupabaseClient<Database>,
  receiptId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Receipt", receiptId)
    .eq("companyId", companyId);
}

export async function getShipmentTracking(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Shipment", shipmentId)
    .eq("companyId", companyId);
}

export async function getDefaultStorageUnitForJob(
  client: SupabaseClient<Database>,
  itemId: string,
  locationId: string,
  companyId: string
): Promise<string | null> {
  const pickMethod = await client
    .from("pickMethod")
    .select("defaultStorageUnitId")
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (pickMethod.data?.defaultStorageUnitId) {
    return pickMethod.data.defaultStorageUnitId;
  }

  const itemStorageUnitQuantities = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  if (itemStorageUnitQuantities.data?.length) {
    // Find the storage unit with the highest quantity
    const storageUnitWithHighestQuantity =
      itemStorageUnitQuantities.data.reduce((max, current) => {
        return (current.quantity ?? 0) > (max.quantity ?? 0) ? current : max;
      });

    return storageUnitWithHighestQuantity.storageUnitId;
  }

  return null;
}
/**
 * Keyset-paginated item-ledger activity for the per-item Activity panel.
 *
 * Pages on `entryNumber` (a NOT NULL, per-company-unique, monotonic insertion
 * sequence that is co-ordered with `createdAt`), which lets us:
 *  - anchor the first load directly on a specific entry (`inclusive` + the
 *    entry's `entryNumber`) instead of paging from newest, and
 *  - load in both directions (`older` below, `newer` above).
 *
 * Returns rows newest→oldest regardless of direction. No `count` — `hasMore` is
 * inferred from a full page, so there's no whole-table count per request.
 */
export async function getItemLedgerActivity(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    /** entryNumber to page from; omit to start from the newest entry. */
    entryNumber?: number;
    direction?: "older" | "newer";
    /** include the cursor row itself (used for the anchored first load). */
    inclusive?: boolean;
  }
) {
  const pageSize = 20;
  const direction = args.direction ?? "older";

  let query = client
    .from("itemLedger")
    .select("*, storageUnit(name), trackedEntity(readableId)")
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId);

  if (args.entryNumber !== undefined) {
    if (direction === "older") {
      query = args.inclusive
        ? query.lte("entryNumber", args.entryNumber)
        : query.lt("entryNumber", args.entryNumber);
    } else {
      query = args.inclusive
        ? query.gte("entryNumber", args.entryNumber)
        : query.gt("entryNumber", args.entryNumber);
    }
  }

  // Scan toward the requested direction so the page is contiguous with the
  // cursor, then always hand back newest→oldest for rendering/prepending.
  query = query
    .order("entryNumber", { ascending: direction === "newer" })
    .limit(pageSize);

  const { data, error } = await query;

  const rows =
    direction === "newer" ? (data ?? []).slice().reverse() : (data ?? []);
  return { data: rows, hasMore: (data?.length ?? 0) === pageSize, error };
}
