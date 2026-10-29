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

type TrackedEntityStatus = Database["public"]["Enums"]["trackedEntityStatus"];

/**
 * The tracked-entity statuses a shipment of this source may ship. A return to
 * a customer ships returned stock, On Hold until it leaves. A return to a
 * supplier ships good stock or the units an inspection or issue rejected —
 * sending rejects back is the point of the return. Everything else ships
 * Available stock only. `assignShipmentLineEntity`, `ShipmentLines` and
 * `ShipmentPostModal` all read this, so tracking and posting never disagree.
 */
export function shippableEntityStatuses(
  sourceDocument: string | null | undefined
): TrackedEntityStatus[] {
  if (sourceDocument === "Sales Return Order") return ["On Hold"];
  if (sourceDocument === "Purchase Return Order") {
    return ["Available", "Rejected"];
  }
  return ["Available"];
}

/**
 * How many units a supplier return shipment line puts back before shipping
 * them: the line's units an inspection reject already wrote off, less what
 * the line's earlier shipments already put back. The written-off units are
 * the first the line ships.
 */
export function writeOffRestoreQuantity({
  shipped,
  writtenOff,
  shippedBefore
}: {
  shipped: number;
  writtenOff: number;
  shippedBefore: number;
}): number {
  return Math.max(0, Math.min(shipped, writtenOff - shippedBefore));
}

export function isShippableEntityStatus(
  sourceDocument: string | null | undefined,
  status: string | null | undefined
): boolean {
  return (shippableEntityStatuses(sourceDocument) as string[]).includes(
    status ?? ""
  );
}

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * The words of a Receiving search, as `purchaseOrderLinesToReceive.searchText`
 * stores its values: lower-cased, with everything but letters and digits
 * removed. A packing slip prints RAB-514 where Carbon holds RAB514, and both
 * read rab514. Every word must match.
 */
export function receivingSearchTerms(
  search: string | null | undefined
): string[] {
  if (!search) return [];
  return search
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(NOT_ALPHANUMERIC, ""))
    .filter(Boolean);
}

/**
 * Where the search terms occur in `text`, matched the way the search matches
 * (case, spaces and punctuation ignored): sorted, merged `[start, end)` ranges
 * of `text`, so a highlight covers RAB-514 for the term rab514.
 */
export function receivingSearchMatches(
  text: string,
  terms: string[]
): [number, number][] {
  if (!text || terms.length === 0) return [];

  // The normalized text, and for each of its characters the index in `text`
  // it came from.
  let normalized = "";
  const source: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lower = text[i]!.toLowerCase().replace(NOT_ALPHANUMERIC, "");
    for (const char of lower) {
      normalized += char;
      source.push(i);
    }
  }

  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      const end = from + term.length;
      ranges.push([source[from]!, source[end - 1]! + 1]);
      from = normalized.indexOf(term, end);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
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
  companyId: string,
  /** A bin stock is taken from (a sales order line ships from it), not one it
   *  lands in: a non-nettable (quarantine) default is passed over too. */
  { source = false }: { source?: boolean } = {}
): Promise<string | null> {
  const pickMethod = await client
    .from("pickMethod")
    .select("defaultStorageUnitId, storageUnit(effectiveNettable)")
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    pickMethod.data?.defaultStorageUnitId &&
    !(source && pickMethod.data.storageUnit?.effectiveNettable === false)
  ) {
    return pickMethod.data.defaultStorageUnitId;
  }

  const itemStorageUnitQuantities = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  // A non-nettable unit (quarantine) is never the guessed default.
  const stockedIds = Array.from(
    new Set(
      (itemStorageUnitQuantities.data ?? [])
        .map((row) => row.storageUnitId)
        .filter((id): id is string => !!id)
    )
  );
  const nonNettable =
    stockedIds.length > 0
      ? await client
          .from("storageUnit")
          .select("id")
          .in("id", stockedIds)
          .eq("companyId", companyId)
          .eq("effectiveNettable", false)
      : { data: [], error: null };
  // Without the flags any bin could be a quarantine bin: guess none.
  if (nonNettable.error) return null;
  const excluded = new Set((nonNettable.data ?? []).map((row) => row.id));
  const candidates = (itemStorageUnitQuantities.data ?? []).filter(
    (row) => !row.storageUnitId || !excluded.has(row.storageUnitId)
  );

  if (candidates.length) {
    // Find the storage unit with the highest quantity
    const storageUnitWithHighestQuantity = candidates.reduce((max, current) => {
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

export type NonNettableUnit = {
  id: string;
  name: string;
  parentId: string | null;
  nettable: boolean;
  storageTypeIds: string[] | null;
};

/**
 * Why a unit that is nettable by its own flag is non-nettable: one of its own
 * storage types first, else the nearest parent that is non-nettable by its own
 * flag or a type. `units` holds the unit's ancestors by id; `nonNettableTypes`
 * the names of the company's non-nettable storage types by id. Null when
 * nothing above the unit makes it non-nettable.
 */
export function nonNettableSource(
  unit: Pick<NonNettableUnit, "parentId" | "storageTypeIds">,
  units: Map<string, NonNettableUnit>,
  nonNettableTypes: Map<string, string>
): { via: "storageType" | "parent"; name: string } | null {
  const ownType = (unit.storageTypeIds ?? []).find((id) =>
    nonNettableTypes.has(id)
  );
  if (ownType) {
    return { via: "storageType", name: nonNettableTypes.get(ownType)! };
  }

  const seen = new Set<string>();
  let parentId = unit.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = units.get(parentId);
    if (!parent) return null;
    const hasType = (parent.storageTypeIds ?? []).some((id) =>
      nonNettableTypes.has(id)
    );
    if (!parent.nettable || hasType) {
      return { via: "parent", name: parent.name };
    }
    parentId = parent.parentId;
  }
  return null;
}
