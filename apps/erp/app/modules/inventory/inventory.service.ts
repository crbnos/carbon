import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { getNextSequence } from "~/modules/settings";
import type { StorageItem } from "~/types";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getItemStorageUnitQuantities } from "../items/items.service";
import type {
  batchPropertyOrderValidator,
  batchPropertyValidator,
  inventoryAdjustmentValidator,
  inventoryCountLineValidator,
  kanbanValidator,
  pickingListLineValidator,
  pickingListValidator,
  receiptValidator,
  shipmentValidator,
  shippingMethodValidator,
  stockTransferLineValidator,
  stockTransferValidator,
  storageTypeValidator,
  storageUnitValidator,
  warehouseTransferValidator
} from "./inventory.models";
import {
  isPickingListLocked,
  reconcileReceiptLineSerials
} from "./inventory.models";

export async function deleteBatchProperty(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("batchProperty").delete().eq("id", id);
}

export async function deleteKanban(
  client: SupabaseClient<Database>,
  kanbanId: string
) {
  return client.from("kanban").delete().eq("id", kanbanId);
}

export async function deleteReceipt(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receipt").delete().eq("id", receiptId);
}

export async function deleteReceiptLine(
  client: SupabaseClient<Database>,
  receiptLineId: string
) {
  return client.from("receiptLine").delete().eq("id", receiptLineId);
}

export async function deleteStorageUnit(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client.from("storageUnit").delete().eq("id", storageUnitId);
}

/**
 * Deletes a storage unit along with every descendant in its subtree.
 *
 * The `storageUnit_parentId_fkey` FK is `ON DELETE RESTRICT`, so you cannot
 * delete a parent while it still has children. Supabase evaluates FK
 * constraints at statement end, so deleting the whole subtree in a single
 * `WHERE id IN (...)` statement is safe - all referencing rows go away in
 * the same transaction.
 *
 * We fetch the subtree via `storageUnits_recursive` (which already returns
 * self + descendants thanks to `ancestorPath @> ARRAY[id]`).
 */
export async function deleteStorageUnitCascade(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  const descendants = await getStorageUnitDescendants(client, storageUnitId);
  if (descendants.error) return descendants;

  // storageUnits_recursive is a view, so every column is nominally nullable
  // in the generated types. Narrow `id` to a concrete string[] for
  // Supabase's `.in()` signature.
  const ids = (descendants.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => id != null);
  // Safety net: fall back to the single-row delete if the view returned
  // nothing (shouldn't happen — the self row is always in the subtree).
  if (ids.length === 0) {
    return client.from("storageUnit").delete().eq("id", storageUnitId);
  }

  return client.from("storageUnit").delete().in("id", ids);
}

export async function deleteShipment(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipment").delete().eq("id", shipmentId);
}

export async function deleteShipmentLine(
  client: SupabaseClient<Database>,
  shipmentLineId: string
) {
  return client.from("shipmentLine").delete().eq("id", shipmentLineId);
}

export async function deleteShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethodId: string
) {
  return client
    .from("shippingMethod")
    .update({ active: false })
    .eq("id", shippingMethodId);
}

export async function deleteStockTransfer(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client.from("stockTransfer").delete().eq("id", stockTransferId);
}

export async function deleteStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLineId: string
) {
  return client
    .from("stockTransferLine")
    .delete()
    .eq("id", stockTransferLineId);
}

export async function deleteWarehouseTransfer(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client.from("warehouseTransfer").delete().eq("id", transferId);
}

export async function deleteWarehouseTransferLine(
  client: SupabaseClient<Database>,
  transferLineId: string
) {
  return client.from("warehouseTransferLine").delete().eq("id", transferLineId);
}

export async function getItemLedgerPage(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string,
  sortDescending: boolean = false,
  page: number = 1
) {
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from("itemLedger")
    .select("*, storageUnit(name), trackedEntity(readableId)", {
      count: "exact"
    })
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("createdAt", { ascending: !sortDescending })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    return { error };
  }

  return {
    data,
    count,
    page,
    pageSize,
    hasMore: count !== null && offset + pageSize < count
  };
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

export async function getBatchProperties(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
) {
  return client
    .from("batchProperty")
    .select("*")
    .in("itemId", itemIds)
    .eq("companyId", companyId)
    .order("sortOrder");
}

export async function getInventoryItems(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc(
    "get_inventory_quantities",
    {
      location_id: locationId,
      company_id: companyId
    },
    {
      count: "exact"
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);

  return query;
}

export async function getInventoryItemsCount(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("item")
    .select("id", {
      count: "exact"
    })
    .neq("itemTrackingType", "Non-Inventory")
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args);

  return query;
}

export async function getInventoryValuation(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { asOfDate?: string | null; locationId?: string | null }
) {
  return client.rpc("get_inventory_valuation", {
    company_id: companyId,
    as_of_date: args.asOfDate ?? undefined,
    location_id: args.locationId ?? undefined
  });
}

export async function getInventoryValuationTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate?: string | null
) {
  return client.rpc("get_inventory_tie_out", {
    company_id: companyId,
    as_of_date: asOfDate ?? undefined
  });
}

// Draft adjusting journal that brings the GL inventory accounts to the
// subledger valuation — the tie-out's Reconcile action (cutover path for
// adjustments posted before GL posting existed). variance = subledger − GL,
// so the inventory line is +variance and the offset −variance: positive on an
// Asset = debit, negative on the (Expense) adjustment account = credit — raw
// amounts sum to zero. The journal stays Draft: a human reviews and posts it
// from the Journals screen, and the tie-out ignores Draft journals.
// Posted on the tie-out's as-of date — the tie-out only counts journals with
// postingDate <= asOfDate, so a today-dated journal could never resolve a
// backdated variance. Posting may still be rejected if that period is Closed.
export async function createInventoryReconciliationJournal(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  args: { asOfDate: string; userId: string }
) {
  const [tieOut, accountDefaults] = await Promise.all([
    getInventoryValuationTieOut(client, companyId, args.asOfDate),
    client
      .from("accountDefault")
      .select("inventoryAdjustmentVarianceAccount")
      .eq("companyId", companyId)
      .single()
  ]);
  if (tieOut.error) return tieOut;
  if (accountDefaults.error) return accountDefaults;

  const rows = (tieOut.data ?? []).filter(
    (row) => Math.abs(Number(row.variance)) > 0.005
  );
  if (rows.length === 0) {
    return {
      data: null,
      error: { message: "Nothing to reconcile — variance is zero" }
    };
  }

  const nextSequence = await getNextSequence(client, "journalEntry", companyId);
  if (nextSequence.error) return nextSequence;
  const journalEntryId = nextSequence.data;

  // Header + lines in one transaction — a partial failure must not leave an
  // orphaned Draft header behind.
  try {
    const journalId = await db.transaction().execute(async (trx) => {
      const journal = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          description: `Inventory subledger reconciliation as of ${args.asOfDate}`,
          postingDate: args.asOfDate,
          sourceType: "Manual" as const,
          status: "Draft" as const,
          companyId,
          createdBy: args.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("journalLine")
        .values(
          rows.flatMap((row) => {
            const variance = Number(row.variance);
            const journalLineReference = crypto.randomUUID();
            return [
              {
                journalId: journal.id,
                accountId: row.accountId,
                description: `Reconcile ${row.accountName} to subledger`,
                amount: variance,
                journalLineReference,
                companyId
              },
              {
                journalId: journal.id,
                accountId:
                  accountDefaults.data.inventoryAdjustmentVarianceAccount,
                description: "Inventory Adjustment",
                amount: -variance,
                journalLineReference,
                companyId
              }
            ];
          })
        )
        .execute();

      return journal.id;
    });
    return { data: { journalId }, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to create reconciliation journal"
      }
    };
  }
}

export async function getKanbans(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("kanbans")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getKanban(
  client: SupabaseClient<Database>,
  kanbanId: string
) {
  return client.from("kanbans").select("*").eq("id", kanbanId).single();
}

export async function getStockTransfer(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client
    .from("stockTransfer")
    .select("*")
    .eq("id", stockTransferId)
    .single();
}

export async function getStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLineId: string
) {
  return client
    .from("stockTransferLines")
    .select("*")
    .eq("id", stockTransferLineId)
    .single();
}

export async function getStockTransferLines(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client
    .from("stockTransferLines")
    .select("*")
    .eq("stockTransferId", stockTransferId)
    .order("itemReadableId", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getStockTransferTracking(
  client: SupabaseClient<Database>,
  stockTransferId: string,
  companyId: string
) {
  return client
    .from("trackedActivity")
    .select("attributes, trackedActivityInput(trackedEntityId)")
    .eq("sourceDocument", "Stock Transfer")
    .eq("sourceDocumentId", stockTransferId)
    .eq("companyId", companyId);
}

export async function getStockTransfers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("stockTransfer")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("stockTransferId", `%${args.search}%`);
  }

  if (args.locationId) {
    query = query.eq("locationId", args.locationId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "stockTransferId", ascending: false }
  ]);
  return query;
}

export async function getDefaultStorageUnitOrStorageUnitWithHighestQuantity(
  client: SupabaseClient<Database>,
  itemId: string,
  locationId: string,
  companyId: string
) {
  const pickMethod = await client
    .from("pickMethod")
    .select("defaultStorageUnitId")
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (pickMethod.data?.defaultStorageUnitId)
    return pickMethod.data.defaultStorageUnitId;

  const storageUnits = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  const storageUnitWithHighestQuantity = storageUnits.data?.reduce(
    (acc, curr) => {
      return acc.quantity > curr.quantity
        ? acc
        : { ...curr, quantity: acc.quantity, storageUnitId: acc.storageUnitId };
    },
    { quantity: 0, storageUnitId: null }
  );

  return storageUnitWithHighestQuantity?.storageUnitId ?? null;
}

export async function getReceipts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("receipt")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `receiptId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "receiptId", ascending: false }
  ]);
  return query;
}

export async function getReceipt(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receipt").select("*").eq("id", receiptId).single();
}

export async function getReceiptLines(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receiptLines").select("*").eq("receiptId", receiptId);
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

export async function getReceiptLineTracking(
  client: SupabaseClient<Database>,
  receiptLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Receipt Line", receiptLineId)
    .eq("companyId", companyId);
}

/**
 * Deletes stale serial tracked entities for a receipt's serial-tracked lines
 * before posting. Post-receipt flips one serial per index in
 * [0, receivedQuantity) to Available; orphaned (reduced quantity) or duplicate
 * (edited serial) entities would otherwise become phantom Available serials.
 * The keep/delete decision is owned by `reconcileReceiptLineSerials` so it
 * stays in lockstep with the post-time validation in ReceiptPostModal.
 */
export async function reconcileReceiptSerialEntities(
  client: SupabaseClient<Database>,
  args: {
    receiptId: string;
    companyId: string;
    lines: {
      id: string;
      receivedQuantity: number | null;
      requiresSerialTracking?: boolean | null;
    }[];
  }
) {
  const serialLines = args.lines.filter((line) => line.requiresSerialTracking);
  if (serialLines.length === 0) return;

  const { data: serialEntities } = await client
    .from("trackedEntity")
    .select("id, attributes, createdAt, readableId")
    .eq("attributes ->> Receipt", args.receiptId)
    .eq("companyId", args.companyId);

  const idsToDelete = serialLines.flatMap((line) => {
    const entities = (serialEntities ?? [])
      .filter(
        (e) =>
          (e.attributes as TrackedEntityAttributes)?.["Receipt Line"] ===
          line.id
      )
      .map((e) => ({
        id: e.id,
        index: (e.attributes as TrackedEntityAttributes)?.[
          "Receipt Line Index"
        ],
        hasSerial: !!e.readableId,
        createdAt: e.createdAt
      }));
    return reconcileReceiptLineSerials(
      entities,
      Number(line.receivedQuantity ?? 0)
    ).surplusEntityIds;
  });

  if (idsToDelete.length > 0) {
    await client
      .from("trackedEntity")
      .delete()
      .in("id", idsToDelete)
      .eq("companyId", args.companyId);
  }
}

export async function getReceiptFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  lineIds: string[]
): Promise<{ data: StorageItem[]; error: string | null }> {
  const promises = lineIds.map((lineId) =>
    client.storage
      .from("private")
      .list(`${companyId}/inventory/${lineId}`)
      .then((result) => ({
        ...result,
        lineId
      }))
  );

  const results = await Promise.all(promises);

  // Check for errors
  const firstError = results.find((result) => result.error);
  if (firstError) {
    return {
      data: [],
      error: firstError.error?.message ?? "Failed to fetch files"
    };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId
      }))
    ),
    error: null
  };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  // Smart default order: expiring soonest first (FEFO, nulls last), then oldest
  // first (FIFO). Surfaces that don't use the TrackedEntityPicker still get a
  // sensible pick order; the picker re-sorts client-side when the user switches.
  let query = client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("quantity", 1)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });

  return query;
}

/**
 * Available tracked entities for an item at a location, one row per entity, with
 * its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker.
 * `excludeLineside` drops lineside (work-center) bins (picking sources from the
 * warehouse). `excludeAllocated` nets out quantities already allocated to other
 * non-cancelled picking lines so the same lot is never recommended twice;
 * `excludeLineId` keeps the current line's own allocation visible.
 */
export async function getAvailableTrackedEntities(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    excludeLineside?: boolean;
    excludeAllocated?: boolean;
    excludeLineId?: string | null;
  }
) {
  return client.rpc("get_available_tracked_entities", {
    p_item_id: args.itemId,
    p_company_id: args.companyId,
    p_location_id: args.locationId,
    p_exclude_lineside: args.excludeLineside ?? false,
    p_exclude_allocated: args.excludeAllocated ?? false,
    p_exclude_line_id: args.excludeLineId ?? undefined
  });
}

/**
 * The configured tracked-entity pick order for an item at a location, used as
 * the picker's default sort. Falls back to "Default" (smart) when unset.
 */
export async function getPickOrder(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<Database["public"]["Enums"]["pickMethodSortMethod"]> {
  const { data } = await client
    .from("pickMethod")
    .select("sortMethod")
    .eq("itemId", args.itemId)
    .eq("locationId", args.locationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  return data?.sortMethod ?? "Default";
}

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .gte("quantity", 1)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });
}

export async function getStorageUnitsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageUnit", "id, name", (query) =>
    query.eq("active", true).eq("companyId", companyId).order("name")
  );
}

export async function getStorageUnitsListForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageUnit", "id, name", (query) =>
    query
      .eq("active", true)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .order("name")
  );
}

// Tree shape from storageUnits_recursive view: each row has its 1-based depth
// and the full ancestorPath (root → node ids). Sort by ancestorPath so the
// caller can render a flat list that visually nests by depth.
export async function getStorageUnitsTreeForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    parentId: string | null;
    depth: number;
    ancestorPath: string[];
  }>(
    client,
    "storageUnits_recursive",
    "id, name, parentId, depth, ancestorPath",
    (query) =>
      query
        .eq("active", true)
        .eq("companyId", companyId)
        .eq("locationId", locationId)
  );
}

export async function getStorageUnits(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  // Query the recursive view so the table gets depth + ancestorPath + parentId
  // for tree rendering (indentation, hierarchy filters, subtree rollups).
  let query = client
    .from("storageUnits_recursive")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  // Default ordering: breadth-first by ancestorPath so parents render before
  // children in the table. Caller-supplied sorts override when provided.
  query = setGenericQueryFilters(query, args, [
    { column: "ancestorPath", ascending: true }
  ]);

  return query;
}

export async function getStorageUnit(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client
    .from("storageUnit")
    .select("*")
    .eq("id", storageUnitId)
    .single();
}

export async function getEffectiveWorkCenterId(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client.rpc("get_effective_work_center_id", {
    p_storage_unit_id: storageUnitId
  });
}

// Roots only (depth = 1). Honors search/filter/pagination so the table can
// paginate top-level storage units while children load lazily on demand.
export async function getStorageUnitRoots(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("storageUnits_recursive")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .eq("depth", 1);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);

  return query;
}

// Immediate children of a single parent (one level deep). Used by the lazy
// expand handler in the StorageUnits table.
export async function getStorageUnitChildren(
  client: SupabaseClient<Database>,
  parentId: string
) {
  return client
    .from("storageUnits_recursive")
    .select("*")
    .eq("parentId", parentId)
    .order("name");
}

// Descendants of the given root ids, from just below the roots (depth > 1) down
// to `maxDepth` inclusive. A node is a descendant of a root when that root
// appears in its ancestorPath, so a single `overlaps` query returns the
// subtrees in one round trip. Used to render the tree expanded by default;
// the depth cap keeps very deep trees from loading their entire subtree
// eagerly — anything below `maxDepth` still lazy-loads on demand.
export async function getStorageUnitSubtrees(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  rootIds: string[],
  maxDepth: number
) {
  if (rootIds.length === 0) {
    return { data: [] as any[], error: null };
  }
  return client
    .from("storageUnits_recursive")
    .select("*")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .gt("depth", 1)
    .lte("depth", maxDepth)
    .overlaps("ancestorPath", rootIds)
    .order("name");
}

// Set of storageUnit ids that have at least one child in the given location.
// Drives whether the table renders an expand chevron on a row.
export async function getStorageUnitParentIdsWithChildren(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  const { data, error } = await client
    .from("storageUnit")
    .select("parentId")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .not("parentId", "is", null);

  if (error) return { data: [] as string[], error };

  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.parentId) ids.add(row.parentId);
  }
  return { data: Array.from(ids), error: null };
}

// Search-mode payload: every storage unit whose name matches `search` PLUS
// every ancestor of each match, so the tree path renders intact. Returns the
// flat ordered row set + the parentIds that should be pre-expanded so that
// matches are visible to the user.
export async function searchStorageUnitsWithAncestors(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  search: string
) {
  const matches = await client
    .from("storageUnits_recursive")
    .select("id, parentId, ancestorPath")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .ilike("name", `%${search}%`);

  if (matches.error)
    return { rows: [], expandedParentIds: [], error: matches.error };

  const idsToFetch = new Set<string>();
  const expanded = new Set<string>();
  for (const row of matches.data ?? []) {
    for (const ancestorId of row.ancestorPath ?? []) {
      idsToFetch.add(ancestorId);
    }
    // Pre-expand every node on the chain except the match itself, so the
    // match becomes visible. ancestorPath includes the node itself at the end.
    for (const ancestorId of (row.ancestorPath ?? []).slice(0, -1)) {
      expanded.add(ancestorId);
    }
  }

  if (idsToFetch.size === 0) {
    return { rows: [], expandedParentIds: [], error: null };
  }

  const rows = await client
    .from("storageUnits_recursive")
    .select("*")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .in("id", Array.from(idsToFetch))
    .order("ancestorPath");

  if (rows.error) return { rows: [], expandedParentIds: [], error: rows.error };

  return {
    rows: rows.data ?? [],
    expandedParentIds: Array.from(expanded),
    error: null
  };
}

export async function getStockMovements(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("itemLedgers")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    // Strip characters that are structural in a PostgREST `.or(...)` filter
    // (comma separates conditions, parens group them) so the search value can't
    // alter the filter shape.
    const search = args.search.replace(/[,()\\]/g, " ");
    query = query.or(
      `itemReadableId.ilike.%${search}%,itemDescription.ilike.%${search}%,locationName.ilike.%${search}%,storageUnitName.ilike.%${search}%,trackedEntityReadableId.ilike.%${search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false },
    { column: "entryNumber", ascending: false }
  ]);
  return query;
}

export async function getShipments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("shipment")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `shipmentId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "shipmentId", ascending: false }
  ]);
  return query;
}

export async function getShipment(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipment").select("*").eq("id", shipmentId).single();
}

export async function getShipmentLines(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client
    .from("shipmentLines")
    .select("*, fulfillment(*, job(*))")
    .eq("shipmentId", shipmentId);
}

export async function getShipmentLinesWithDetails(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipmentLines").select("*").eq("shipmentId", shipmentId);
}

export async function getShipmentFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  lineIds: string[]
): Promise<{ data: StorageItem[]; error: string | null }> {
  const promises = lineIds.map((lineId) =>
    client.storage
      .from("private")
      .list(`${companyId}/inventory/${lineId}`)
      .then((result) => ({
        ...result,
        lineId
      }))
  );

  const results = await Promise.all(promises);

  // Check for errors
  const firstError = results.find((result) => result.error);
  if (firstError) {
    return {
      data: [],
      error: firstError.error?.message ?? "Failed to fetch files"
    };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId
      }))
    ),
    error: null
  };
}

export async function getShipmentRelatedItems(
  client: SupabaseClient<Database>,
  shipmentId: string,
  sourceDocumentId: string
) {
  const salesOrder = await client
    .from("salesOrder")
    .select("*")
    .eq("id", sourceDocumentId)
    .single();

  const invoices = await client
    .from("salesInvoice")
    .select("*")
    .or(
      `shipmentId.eq.${shipmentId},opportunityId.eq.${
        salesOrder.data?.opportunityId ?? ""
      }`
    );

  return {
    invoices: invoices.data ?? []
  };
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

export async function getShipmentLineTracking(
  client: SupabaseClient<Database>,
  shipmentLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Shipment Line", shipmentLineId)
    .eq("companyId", companyId);
}

export async function getShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethodId: string
) {
  return client
    .from("shippingMethod")
    .select("*")
    .eq("id", shippingMethodId)
    .single();
}

export async function getShippingMethods(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("shippingMethod")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,carrier.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getShippingMethodsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("shippingMethod")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getShippingTermsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("shippingTerm")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getTrackedEntities(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("trackedEntity")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .neq("status", "Reserved");

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "sourceDocumentReadableId", ascending: true }
  ]);
  return query;
}

export async function getTrackedEntitiesByMakeMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .order("createdAt", { ascending: true });
}

export async function getTrackedEntity(
  client: SupabaseClient<Database>,
  trackedEntityId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("id", trackedEntityId)
    .single();
}

/**
 * Manual override of a tracked entity's expirationDate. Records the prior
 * value, the new value, and a reason on the entity's `attributes` JSONB
 * under the "expiryOverrides" array so the trace popover can show the
 * provenance later.
 *
 *   attributes.expiryOverrides = [
 *     {
 *       previous: "2026-04-25" | null,
 *       next:     "2026-05-10",
 *       reason:   "Re-tested and re-certified by QC",
 *       userId,
 *       at:       "2026-04-26T10:11:12Z"
 *     },
 *     ...
 *   ]
 */
export async function updateTrackedEntityExpiry(
  client: SupabaseClient<Database>,
  args: {
    trackedEntityId: string;
    expirationDate: string | null;
    reason: string;
    userId: string;
    source?: string;
  }
) {
  const existing = await client
    .from("trackedEntity")
    .select("expirationDate, attributes, status")
    .eq("id", args.trackedEntityId)
    .single();
  if (existing.error) return existing;

  if (existing.data?.status === "Consumed") {
    return {
      data: null,
      error: {
        message: "Cannot edit expiry of a consumed tracked entity"
      } as unknown as PostgrestError
    };
  }

  const prevAttrs =
    (existing.data?.attributes as Record<string, unknown> | null) ?? {};
  const prevHistory = Array.isArray(prevAttrs.expiryOverrides)
    ? (prevAttrs.expiryOverrides as Record<string, unknown>[])
    : [];

  const nextAttrs = {
    ...prevAttrs,
    expiryOverrides: [
      ...prevHistory,
      {
        previous: existing.data?.expirationDate ?? null,
        next: args.expirationDate,
        reason: args.reason,
        source: args.source ?? null,
        userId: args.userId,
        at: now(getLocalTimeZone()).toAbsoluteString()
      }
    ]
  };

  return client
    .from("trackedEntity")
    .update({
      expirationDate: args.expirationDate,
      attributes: nextAttrs as unknown as Json
    })
    .eq("id", args.trackedEntityId);
}

export async function getTrackedEntitiesByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const jobOperation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", operationId)
    .single();

  if (jobOperation.error || !jobOperation.data.jobMakeMethodId)
    return {
      data: null,
      error: jobOperation.error
    };

  return getTrackedEntitiesByMakeMethodId(
    client,
    jobOperation.data.jobMakeMethodId
  );
}

export async function getWarehouseTransfers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("warehouseTransfer")
    .select(
      "*, fromLocation:location!fromLocationId(name), toLocation:location!toLocationId(name)",
      {
        count: "exact"
      }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `transferId.ilike.%${args.search}%,reference.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "transferId", ascending: false }
  ]);
  return query;
}

export async function getWarehouseTransfer(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client
    .from("warehouseTransfer")
    .select(
      "*, fromLocation:location!fromLocationId(*), toLocation:location!toLocationId(*)"
    )
    .eq("id", transferId)
    .single();
}

export async function getWarehouseTransferLine(
  client: SupabaseClient<Database>,
  transferId: string,
  lineId: string
) {
  return client
    .from("warehouseTransferLine")
    .select(
      "*, warehouseTransfer(*, fromLocation:location!fromLocationId(name), toLocation:location!toLocationId(name))"
    )
    .eq("id", lineId)
    .eq("transferId", transferId)
    .single();
}

export async function getWarehouseTransferLines(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client
    .from("warehouseTransferLine")
    .select(
      "*, item(*), fromStorageUnit:storageUnit!fromStorageUnitId(name), toStorageUnit:storageUnit!toStorageUnitId(name)"
    )
    .eq("transferId", transferId);
}

// Thin wrapper over the post-inventory-adjustment edge function — the single
// write path for manual adjustments (shared with MES). The edge function owns
// Set Quantity resolution, storage-unit transfers, serial/batch stock-target
// resolution, tracked-entity updates, cost layers, and GL posting (only when
// companySettings.accountingEnabled) in one transaction.
export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  // `requiresSerialTracking` is a form-only flag for the validator's serial
  // quantity guard — the route strips it before calling this.
  inventoryAdjustment: Omit<
    z.infer<typeof inventoryAdjustmentValidator>,
    "requiresSerialTracking"
  > & {
    companyId: string;
    createdBy: string;
  }
) {
  const { companyId, createdBy, ...adjustment } = inventoryAdjustment;

  const result = await client.functions.invoke<{
    success: boolean;
    itemLedger: { id: string } | null;
  }>("post-inventory-adjustment", {
    body: { ...adjustment, companyId, userId: createdBy }
  });

  if (result.error) {
    // Bare-string error, matching the old service's validation-branch
    // contract — the adjustment route compares `error === "<message>"`.
    return {
      data: null,
      error: await getEdgeFunctionErrorMessage(
        result.error,
        "Failed to create manual inventory adjustment"
      )
    };
  }

  return { data: result.data?.itemLedger ?? null, error: null };
}

// ===========================================================================
// Inventory Count / Cycle Count
// ===========================================================================

export async function getInventoryCounts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("inventoryCount")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("inventoryCountId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "inventoryCountId", ascending: false }
  ]);
  return query;
}

export async function getInventoryCount(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("inventoryCount")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getInventoryCountLines(
  client: SupabaseClient<Database>,
  inventoryCountId: string,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("inventoryCountLine")
    .select(
      "*, item!inner(name, readableIdWithRevision, type, itemTrackingType, unitOfMeasureCode, thumbnailPath)",
      {
        count: "exact"
      }
    )
    .eq("inventoryCountId", inventoryCountId)
    .eq("companyId", companyId);

  if (args.search) {
    // Strip characters that are structural in a PostgREST `.or(...)` filter so
    // the search value can't alter the filter shape.
    const search = args.search.replace(/[,()\\]/g, " ");
    // Search the item's identity (part number / name); the line's own readableId
    // is only the batch/serial and is null for most rows.
    query = query.or(
      `name.ilike.%${search}%,readableIdWithRevision.ilike.%${search}%`,
      { foreignTable: "item" }
    );
  }

  // Snapshot lines all share one insert timestamp, so order by the item's part
  // number for a readable count sheet and fall back to the line id for a stable,
  // deterministic order.
  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true, foreignTable: "item" },
    { column: "id", ascending: true }
  ]);
  return query;
}

// Aggregate counts for the confirm dialog. Computed server-side so the warnings
// stay accurate regardless of which page of lines is currently loaded.
export async function getInventoryCountLineSummary(
  client: SupabaseClient<Database>,
  inventoryCountId: string,
  companyId: string
) {
  const base = () =>
    client
      .from("inventoryCountLine")
      .select("id", { count: "exact", head: true })
      .eq("inventoryCountId", inventoryCountId)
      .eq("companyId", companyId);

  const [uncounted, variances] = await Promise.all([
    base().is("countedQuantity", null),
    base().not("countedQuantity", "is", null).not("variance", "eq", 0)
  ]);

  return {
    uncounted: uncounted.count ?? 0,
    variances: variances.count ?? 0
  };
}

// Every item-ledger adjustment a count posted (including rectify corrections),
// found via the movement's `documentType`/`documentId` back-reference. Used to
// show a posted count what it actually did to inventory. Chronological.
export async function getInventoryCountMovements(
  client: SupabaseClient<Database>,
  companyId: string,
  inventoryCountId: string
) {
  return client
    .from("itemLedgers")
    .select("*")
    .eq("companyId", companyId)
    .eq("documentType", "Inventory Count")
    .eq("documentId", inventoryCountId)
    .order("createdAt", { ascending: true })
    .order("entryNumber", { ascending: true });
}

// Counts are created once and never edited as a header (only their lines and
// status change), so this is insert-only — no upsert/update branch.
export async function insertInventoryCount(
  client: SupabaseClient<Database>,
  inventoryCount: {
    inventoryCountId: string;
    locationId: string;
    isBlind: boolean;
    notes?: string | null;
    scope?: Json;
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("inventoryCount")
    .insert([inventoryCount])
    .select("id")
    .single();
}

export async function deleteInventoryCount(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("inventoryCount")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// Snapshot the current on-hand into count lines: one line per
// (item, storage unit, tracked entity) bucket that has any ledger history in
// scope — positive, negative, or net-zero — so the counter can verify expected-
// empty bins and correct discrepancies. On-hand is summed from `itemLedger`
// (status-aware: excludes Rejected, matching `get_inventory_quantities`).
// Idempotent: safe to re-run to re-snapshot while the count is Draft.
export async function generateInventoryCountLines(
  db: Kysely<KyselyDatabase>,
  args: {
    inventoryCountId: string;
    companyId: string;
    locationId: string;
    createdBy: string;
    storageUnitIds?: string[];
    itemType?: string;
  }
) {
  const {
    inventoryCountId,
    companyId,
    locationId,
    createdBy,
    storageUnitIds,
    itemType
  } = args;

  return db.transaction().execute(async (trx) => {
    let aggregate = trx
      .selectFrom("itemLedger")
      .innerJoin("item", "item.id", "itemLedger.itemId")
      .select([
        "itemLedger.itemId as itemId",
        "itemLedger.storageUnitId as storageUnitId",
        "itemLedger.trackedEntityId as trackedEntityId"
      ])
      .select((eb) => eb.fn.sum<number>("itemLedger.quantity").as("quantity"))
      .where("itemLedger.companyId", "=", companyId)
      .where("itemLedger.locationId", "=", locationId)
      // Status-aware on-hand: exclude Rejected stock so `systemQuantity` matches
      // the `get_inventory_quantities` definition of quantityOnHand (which is
      // `SUM(quantity) WHERE trackedEntityStatus IS NULL OR != 'Rejected'`) used
      // everywhere else in the app. Non-tracked rows have a NULL status.
      .where((eb) =>
        eb.or([
          eb("itemLedger.trackedEntityStatus", "is", null),
          eb("itemLedger.trackedEntityStatus", "!=", "Rejected")
        ])
      )
      .groupBy([
        "itemLedger.itemId",
        "itemLedger.storageUnitId",
        "itemLedger.trackedEntityId"
      ]);
    // Drop blank entries — an unselected storage-unit field submits [""], which
    // would otherwise filter to `storageUnitId IN ('')` and match no stock.
    const scopedStorageUnitIds = storageUnitIds?.filter(Boolean) ?? [];
    if (scopedStorageUnitIds.length > 0) {
      aggregate = aggregate.where(
        "itemLedger.storageUnitId",
        "in",
        scopedStorageUnitIds
      );
    }

    if (itemType) {
      aggregate = aggregate.where(
        "item.type",
        "=",
        itemType as Database["public"]["Enums"]["itemType"]
      );
    }

    const buckets = await aggregate.execute();

    // Resolve denormalized tracked-entity labels for the snapshot lines.
    const trackedEntityIds = buckets
      .map((b) => b.trackedEntityId)
      .filter((id): id is string => Boolean(id));

    const trackedEntities = trackedEntityIds.length
      ? await trx
          .selectFrom("trackedEntity")
          .select(["id", "readableId"])
          .where("id", "in", trackedEntityIds)
          .where("companyId", "=", companyId)
          .execute()
      : [];

    const readableIdByEntity = new Map(
      trackedEntities.map((te) => [te.id, te.readableId])
    );

    // Regenerate from scratch (only valid while Draft).
    await trx
      .deleteFrom("inventoryCountLine")
      .where("inventoryCountId", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .execute();

    if (buckets.length > 0) {
      await trx
        .insertInto("inventoryCountLine")
        .values(
          buckets.map((bucket) => ({
            inventoryCountId,
            companyId,
            itemId: bucket.itemId,
            locationId,
            storageUnitId: bucket.storageUnitId,
            trackedEntityId: bucket.trackedEntityId,
            readableId: bucket.trackedEntityId
              ? (readableIdByEntity.get(bucket.trackedEntityId) ?? null)
              : null,
            systemQuantity: Number(bucket.quantity ?? 0),
            createdBy
          }))
        )
        .execute();
    }

    await trx
      .updateTable("inventoryCount")
      .set({ snapshotAt: new Date().toISOString() })
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .execute();

    return buckets.length;
  });
}

// Refresh a count's frozen `systemQuantity` to the current live on-hand WITHOUT
// touching the entered `countedQuantity`. Used by Rectify: reopening a Posted
// count re-baselines the snapshot to now, so re-posting applies the corrected
// count on top of current stock. A full regenerate would wipe the counts; this
// only moves the baseline forward. The calling route guards status; re-stamps
// `snapshotAt`.
type ResnapshotInventoryCountArgs = {
  inventoryCountId: string;
  companyId: string;
  locationId: string;
  updatedBy: string;
};

// Re-baseline each line's `systemQuantity` to fresh live on-hand, inside a
// caller-supplied transaction. A `Transaction` is a `Kysely`, so callers pass
// `trx`; this never opens its own transaction, letting a caller (rectify) bundle
// it with a status guard + status flip atomically.
async function resnapshotInventoryCountLinesInTrx(
  trx: Kysely<KyselyDatabase>,
  args: ResnapshotInventoryCountArgs
) {
  const { inventoryCountId, companyId, locationId, updatedBy } = args;

  const bucketKey = (
    itemId: string,
    storageUnitId: string | null,
    trackedEntityId: string | null
  ) => `${itemId}|${storageUnitId ?? ""}|${trackedEntityId ?? ""}`;

  const lines = await trx
    .selectFrom("inventoryCountLine")
    .select(["id", "itemId", "storageUnitId", "trackedEntityId"])
    .where("inventoryCountId", "=", inventoryCountId)
    .where("companyId", "=", companyId)
    .execute();

  // Fresh status-aware on-hand for the location, grouped by bucket (matches
  // `generateInventoryCountLines` / `get_inventory_quantities`).
  const onHandRows = await trx
    .selectFrom("itemLedger")
    .select(["itemId", "storageUnitId", "trackedEntityId"])
    .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
    .where("companyId", "=", companyId)
    .where("locationId", "=", locationId)
    .where((eb) =>
      eb.or([
        eb("trackedEntityStatus", "is", null),
        eb("trackedEntityStatus", "!=", "Rejected")
      ])
    )
    .groupBy(["itemId", "storageUnitId", "trackedEntityId"])
    .execute();

  const onHandByBucket = new Map(
    onHandRows.map((r) => [
      bucketKey(r.itemId, r.storageUnitId, r.trackedEntityId),
      Number(r.quantity ?? 0)
    ])
  );

  const now = new Date().toISOString();
  for (const line of lines) {
    await trx
      .updateTable("inventoryCountLine")
      .set({
        systemQuantity:
          onHandByBucket.get(
            bucketKey(line.itemId, line.storageUnitId, line.trackedEntityId)
          ) ?? 0,
        updatedBy,
        updatedAt: now
      })
      .where("id", "=", line.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  await trx
    .updateTable("inventoryCount")
    .set({ snapshotAt: now, updatedBy, updatedAt: now })
    .where("id", "=", inventoryCountId)
    .where("companyId", "=", companyId)
    .execute();

  return lines.length;
}

// Rectify a posted count in one transaction: lock the row, verify it is still
// Posted, re-baseline the lines, and flip it back to Draft — all-or-nothing.
// This closes the race the previous two-step route left open (a count could be
// re-snapshotted while remaining Posted if the second write failed or a
// concurrent request slipped in between). Throws on rollback; the route maps it
// to a flash. Kysely bypasses RLS — authorize at the route first.
export async function rectifyInventoryCount(
  db: Kysely<KyselyDatabase>,
  args: ResnapshotInventoryCountArgs
) {
  const { inventoryCountId, companyId, updatedBy } = args;
  return db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom("inventoryCount")
      .select(["id", "status"])
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!locked) throw new Error("Inventory count not found");
    if (locked.status !== "Posted") {
      throw new Error("Only a posted count can be rectified");
    }

    await resnapshotInventoryCountLinesInTrx(trx, args);

    await trx
      .updateTable("inventoryCount")
      .set({ status: "Draft", updatedBy, updatedAt: new Date().toISOString() })
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .execute();
  });
}

// Persist a single line's counted quantity. Uses Kysely so the Draft-only guard
// is part of the same statement: the EXISTS subquery checks the parent count is
// still Draft *atomically* with the write, closing the TOCTOU window a separate
// read-then-update would leave open (a concurrent Confirm can't slip in between).
// Returns the updated row id, or undefined when the line doesn't exist or the
// count is no longer Draft. Kysely bypasses RLS — authorize at the route first.
export async function updateInventoryCountLine(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof inventoryCountLineValidator> & {
    companyId: string;
    countedBy: string;
  }
) {
  const { id, countedQuantity, companyId, countedBy } = args;
  const now = new Date().toISOString();
  // Clearing a count (null) un-counts the line, so the count audit fields are
  // cleared too; only an actual count stamps countedBy/countedAt.
  const isCounted = countedQuantity !== undefined && countedQuantity !== null;
  return db
    .updateTable("inventoryCountLine")
    .set({
      countedQuantity: countedQuantity ?? null,
      countedBy: isCounted ? countedBy : null,
      countedAt: isCounted ? now : null,
      updatedBy: countedBy,
      updatedAt: now
    })
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("inventoryCount")
          .select("inventoryCount.id")
          .whereRef(
            "inventoryCount.id",
            "=",
            "inventoryCountLine.inventoryCountId"
          )
          .where("inventoryCount.companyId", "=", companyId)
          // Counted quantities are entered while the count is Draft; once it
          // moves on (Pending/Posted) the lines are no longer writable.
          .where("inventoryCount.status", "=", "Draft")
      )
    )
    .returning("id")
    .executeTakeFirst();
}

export async function updateInventoryCountStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    status: Database["public"]["Enums"]["inventoryCountStatus"];
    updatedBy: string;
    // When set, the transition only applies if the row is still in this status.
    // The `.eq("status", expectedStatus)` makes the read-then-write atomic, so a
    // concurrent transition can't be clobbered (0 rows matched → `.single()`
    // errors and the caller surfaces a failure).
    expectedStatus?: Database["public"]["Enums"]["inventoryCountStatus"];
  }
) {
  const { id, companyId, status, updatedBy, expectedStatus } = args;
  let query = client
    .from("inventoryCount")
    .update({ status, updatedBy, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("companyId", companyId);
  if (expectedStatus) query = query.eq("status", expectedStatus);
  return query.select("id").single();
}

export async function updateBatchPropertyOrder(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof batchPropertyOrderValidator>,
    "batchPropertyGroupId"
  > & {
    batchPropertyGroupId?: string | null;
    updatedBy: string;
  }
) {
  return client.from("batchProperty").update(sanitize(data)).eq("id", data.id);
}

export async function updateStockTransferStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: Database["public"]["Enums"]["stockTransferStatus"];
    assignee?: string | null;
    completedAt: string | null;
    updatedBy: string;
  }
) {
  const { id, status, assignee, completedAt, updatedBy } = args;
  return client
    .from("stockTransfer")
    .update({
      status,
      assignee,
      completedAt,
      updatedBy
    })
    .eq("id", id);
}

export async function upsertBatchProperty(
  client: SupabaseClient<Database>,
  batchProperty: z.infer<typeof batchPropertyValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { userId, ...data } = batchProperty;
  if (batchProperty.id) {
    return client
      .from("batchProperty")
      .update(
        sanitize({
          ...data,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
      )
      .eq("id", batchProperty.id);
  }

  return client.from("batchProperty").insert({
    ...data,
    createdBy: userId
  });
}

export async function upsertKanban(
  client: SupabaseClient<Database>,
  kanban:
    | (Omit<z.infer<typeof kanbanValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof kanbanValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in kanban) {
    return client
      .from("kanban")
      .insert({
        ...kanban
      })
      .select("id")
      .single();
  }
  return client
    .from("kanban")
    .update({
      ...sanitize(kanban),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", kanban.id)
    .select("id")
    .single();
}

export async function upsertReceipt(
  client: SupabaseClient<Database>,
  receipt:
    | (Omit<z.infer<typeof receiptValidator>, "id" | "receiptId"> & {
        receiptId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof receiptValidator>, "id" | "receiptId"> & {
        id: string;
        receiptId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in receipt) {
    return client.from("receipt").insert([receipt]).select("*").single();
  }
  return client
    .from("receipt")
    .update({
      ...sanitize(receipt),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", receipt.id)
    .select("id")
    .single();
}

export async function upsertStorageUnit(
  client: SupabaseClient<Database>,
  storageUnit:
    | (Omit<z.infer<typeof storageUnitValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof storageUnitValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in storageUnit) {
    return client
      .from("storageUnit")
      .insert({
        ...storageUnit,
        id: nanoid()
      })
      .select("id")
      .single();
  }
  return client
    .from("storageUnit")
    .update({
      ...sanitize(storageUnit),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", storageUnit.id)
    .select("id")
    .single();
}

export async function upsertShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethod:
    | (Omit<z.infer<typeof shippingMethodValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shippingMethodValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shippingMethod) {
    return client
      .from("shippingMethod")
      .insert([shippingMethod])
      .select("id")
      .single();
  }
  return client
    .from("shippingMethod")
    .update(sanitize(shippingMethod))
    .eq("id", shippingMethod.id)
    .select("id")
    .single();
}

export async function upsertShipment(
  client: SupabaseClient<Database>,
  shipment:
    | (Omit<z.infer<typeof shipmentValidator>, "id" | "shipmentId"> & {
        shipmentId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shipmentValidator>, "id" | "shipmentId"> & {
        id: string;
        shipmentId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shipment) {
    return client.from("shipment").insert([shipment]).select("*").single();
  }
  return client
    .from("shipment")
    .update({
      ...sanitize(shipment),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", shipment.id)
    .select("id")
    .single();
}

export async function upsertStockTransfer(
  client: SupabaseClient<Database>,
  stockTransfer:
    | {
        locationId: string;
        stockTransferId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        locationId: string;
        stockTransferId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in stockTransfer) {
    return client
      .from("stockTransfer")
      .insert({
        ...stockTransfer,
        status: "Released"
      })
      .select("id")
      .single();
  }
  return client
    .from("stockTransfer")
    .update(sanitize(stockTransfer))
    .eq("id", stockTransfer.id)
    .select("id")
    .single();
}

export async function upsertStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLine:
    | (Omit<z.infer<typeof stockTransferLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof stockTransferLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in stockTransferLine) {
    return client
      .from("stockTransferLine")
      .insert(stockTransferLine)
      .select("id")
      .single();
  }
  return client
    .from("stockTransferLine")
    .update(sanitize(stockTransferLine))
    .eq("id", stockTransferLine.id)
    .select("id")
    .single();
}

export async function upsertStockTransferLines(
  client: SupabaseClient<Database>,
  args: {
    lines: z.infer<typeof stockTransferValidator>["lines"];
    stockTransferId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const { lines, stockTransferId, companyId, createdBy } = args;
  return client.from("stockTransferLine").insert(
    lines.map((line) => ({
      ...line,
      stockTransferId,
      companyId,
      createdBy
    }))
  );
}

export async function upsertWarehouseTransfer(
  client: SupabaseClient<Database>,
  transfer:
    | (Omit<z.infer<typeof warehouseTransferValidator>, "id" | "transferId"> & {
        transferId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof warehouseTransferValidator>, "id" | "transferId"> & {
        id: string;
        transferId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in transfer) {
    return client
      .from("warehouseTransfer")
      .insert([transfer])
      .select("*")
      .single();
  }
  return client
    .from("warehouseTransfer")
    .update({
      ...sanitize(transfer),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", transfer.id)
    .select("id")
    .single();
}

export async function updateWarehouseTransferStatus(
  client: SupabaseClient<Database>,
  transferId: string,
  status: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"],
  updatedBy: string
) {
  return client
    .from("warehouseTransfer")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", transferId);
}

export async function upsertWarehouseTransferLine(
  client: SupabaseClient<Database>,
  line:
    | Database["public"]["Tables"]["warehouseTransferLine"]["Insert"]
    | (Database["public"]["Tables"]["warehouseTransferLine"]["Update"] & {
        id: string;
      })
) {
  if ("id" in line && line.id) {
    const { id, ...updateData } = line;
    return client
      .from("warehouseTransferLine")
      .update({
        ...updateData,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();
  } else {
    return client
      .from("warehouseTransferLine")
      .insert({
        ...line,
        createdAt: new Date().toISOString()
      } as Database["public"]["Tables"]["warehouseTransferLine"]["Insert"])
      .select()
      .single();
  }
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

// ----------------------------------------------------------------------------
// storageUnit hierarchy helpers (backed by the storageUnits_recursive view
// defined in 20260417000200_storage-unit-nesting-and-type.sql)
// ----------------------------------------------------------------------------

export async function getStorageUnitTree(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("ancestorPath");
}

export async function getStorageUnitDescendants(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .contains("ancestorPath", [storageUnitId]);
}

export async function expandStorageUnitIdsWithDescendants(
  client: SupabaseClient<Database>,
  storageUnitIds: string[]
): Promise<string[]> {
  if (storageUnitIds.length === 0) return [];
  const { data } = await client
    .from("storageUnits_recursive")
    .select("id")
    .overlaps("ancestorPath", storageUnitIds);
  const expanded = new Set<string>(storageUnitIds);
  (data ?? []).forEach((row) => {
    if (row.id) expanded.add(row.id);
  });
  return Array.from(expanded);
}

// ----------------------------------------------------------------------------
// storageType CRUD (mirrors materialType in items.service.ts)
// ----------------------------------------------------------------------------

export async function getStorageTypeUsage(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("storageUnit")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .contains("storageTypeIds", [id])
    .limit(5);
}

export async function deleteStorageTypeWithCascade(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const { data: units, error: fetchError } = await client
    .from("storageUnit")
    .select("id, storageTypeIds")
    .eq("companyId", companyId)
    .contains("storageTypeIds", [id]);

  if (fetchError) return { error: fetchError };

  for (const unit of units ?? []) {
    const next = (unit.storageTypeIds ?? []).filter((x) => x !== id);
    const { error: updateError } = await client
      .from("storageUnit")
      .update({ storageTypeIds: next })
      .eq("id", unit.id);
    if (updateError) return { error: updateError };
  }

  return client.from("storageType").delete().eq("id", id);
}

export async function getStorageTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("storageType")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getStorageType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("storageType").select("*").eq("id", id).single();
}

export async function getStorageTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageType", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function upsertStorageType(
  client: SupabaseClient<Database>,
  storageType:
    | (Omit<z.infer<typeof storageTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof storageTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in storageType) {
    return client
      .from("storageType")
      .insert({ ...storageType })
      .select("id")
      .single();
  }
  return client
    .from("storageType")
    .update({
      ...sanitize(storageType),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", storageType.id)
    .select("id")
    .single();
}

export async function getShelfLifeForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
) {
  if (itemIds.length === 0) return { data: [], error: null };
  return client
    .from("itemShelfLife")
    .select("itemId, mode, days")
    .in("itemId", itemIds);
}

/**
 * Map of trackedEntityId → expirationDate (or null) for a set of ids.
 * Used by the inventory adjustment modal to prefill the date picker when
 * editing an existing batch / serial.
 */
export async function getTrackedEntityExpirations(
  client: SupabaseClient<Database>,
  trackedEntityIds: string[]
): Promise<Record<string, string | null>> {
  if (trackedEntityIds.length === 0) return {};
  const result = await client
    .from("trackedEntity")
    .select("id, expirationDate")
    .in("id", trackedEntityIds);
  return (result.data ?? []).reduce<Record<string, string | null>>(
    (acc, row) => {
      acc[row.id] = row.expirationDate ?? null;
      return acc;
    },
    {}
  );
}

// ----------------------------------------------------------------------------
// Picking List CRUD
// ----------------------------------------------------------------------------

export async function getPickingLists(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    assignee: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("pickingLists")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("pickingListId", `%${args.search}%`);
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as "Draft" | "In Progress" | "Completed" | "Cancelled"
    );
  }

  if (args.assignee) {
    query = query.eq("assignee", args.assignee);
  }

  if (args.locationId) {
    query = query.eq("locationId", args.locationId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "pickingListId", ascending: false }
  ]);
  return query;
}

export async function getPickingList(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client
    .from("pickingList")
    .select(
      "*, location:location(name), assigneeUser:user!pickingList_assignee_fkey(fullName, avatarUrl)"
    )
    .eq("id", pickingListId)
    .single();
}

export async function getPickingListLines(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client
    .from("pickingListLine")
    .select(
      "*, item(name, readableId, itemTrackingType), job(jobId), jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit!pickingListLine_storageUnitId_fkey(name, locationId), toStorageUnit:storageUnit!pickingListLine_toStorageUnitId_fkey(name, locationId), trackedEntities:pickingListLineTrackedEntity(trackedEntityId, quantity, quantityPicked, trackedEntity(readableId))"
    )
    .eq("pickingListId", pickingListId)
    .order("jobOperationId")
    .order("itemId");
}

/**
 * Per-line WAREHOUSE (non-lineside, incl. the unassigned/null bin) on-hand for
 * a picking list's items — drives the "No Stock" warning. Returns a map of
 * pickingListLineId → availableQuantity.
 */
export async function getPickingListAvailability(
  client: SupabaseClient<Database>,
  pickingListId: string
): Promise<Map<string, number>> {
  const result = await client.rpc("get_picking_list_availability", {
    p_picking_list_id: pickingListId
  });
  const map = new Map<string, number>();
  for (const row of result.data ?? []) {
    map.set(
      (row as { pickingListLineId: string }).pickingListLineId,
      Number(
        (row as { availableQuantity?: number | null }).availableQuantity ?? 0
      )
    );
  }
  return map;
}

export type PickingListRecommendation = {
  trackedEntityId: string;
  readableId: string | null;
};

/**
 * The recommended tracked entities (serial/batch lots) for each tracked picking
 * line, in pick order — surfaced as at-a-glance subtext before the picker opens.
 * One batched RPC fetches every available lot for every item on the list; we then
 * greedily assign distinct lots to lines in pick order so the same serial is never
 * recommended to two lines, and a batch lot is split across lines by remaining qty.
 * Returns a map of pickingListLineId → recommended lots (empty/partial if short).
 */
export async function getPickingListRecommendations(
  client: SupabaseClient<Database>,
  pickingListId: string
): Promise<Record<string, PickingListRecommendation[]>> {
  const [linesResult, availableResult] = await Promise.all([
    client
      .from("pickingListLine")
      .select(
        "id, itemId, quantityToPick, quantityPicked, status, item(itemTrackingType)"
      )
      .eq("pickingListId", pickingListId)
      .order("jobOperationId")
      .order("itemId"),
    client.rpc("get_picking_list_tracked_available", {
      p_picking_list_id: pickingListId
    })
  ]);

  const recommendations: Record<string, PickingListRecommendation[]> = {};
  if (linesResult.error || availableResult.error) return recommendations;

  // Ordered, mutable pool of available lots per item (the RPC already orders each
  // item's rows by its configured pick method).
  const poolByItem = new Map<
    string,
    Array<{ trackedEntityId: string; readableId: string | null; qty: number }>
  >();
  for (const row of availableResult.data ?? []) {
    const list = poolByItem.get(row.itemId) ?? [];
    list.push({
      trackedEntityId: row.trackedEntityId,
      readableId: row.readableId,
      qty: Number(row.availableQuantity ?? 0)
    });
    poolByItem.set(row.itemId, list);
  }

  for (const line of linesResult.data ?? []) {
    const trackingType = (line.item as { itemTrackingType?: string } | null)
      ?.itemTrackingType;
    if (trackingType !== "Serial" && trackingType !== "Batch") continue;

    let remaining =
      Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0);
    if (remaining <= 0) continue;

    const pool = poolByItem.get(line.itemId);
    if (!pool?.length) continue;

    const picks: PickingListRecommendation[] = [];
    while (remaining > 0 && pool.length > 0) {
      const lot = pool[0];
      picks.push({
        trackedEntityId: lot.trackedEntityId,
        readableId: lot.readableId
      });
      const take = Math.min(lot.qty, remaining);
      remaining -= take;
      lot.qty -= take;
      if (lot.qty <= 0) pool.shift();
    }
    recommendations[line.id] = picks;
  }

  return recommendations;
}

export async function getPickingListLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("pickingListLine")
    .select(
      "*, item(name, readableId), job(jobId), jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit!pickingListLine_storageUnitId_fkey(name, locationId), toStorageUnit:storageUnit!pickingListLine_toStorageUnitId_fkey(name, locationId), pickingList(pickingListId, status)"
    )
    .eq("id", lineId)
    .single();
}

export async function getPickingListLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("pickingListLineTrackedEntity")
    .select("*, trackedEntity(readableId, quantity, expirationDate)")
    .eq("pickingListLineId", lineId);
}

/**
 * Pick (or unpick) a tracked (serial/batch) lot for a picking line. A pick
 * MOVES the chosen lot from its warehouse bin to the line's lineside shelf via
 * the `post-picking` edge function (serial/batch), records it on the line, and
 * points the job material at lineside. `unpick` reverses it.
 */
export async function setPickingListLineTrackedEntity(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    trackedEntityId: string;
    fromStorageUnitId?: string | null;
    quantity?: number;
    unpick?: boolean;
    userId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }
  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it to make changes."
    };
  }

  const isSerial = item?.itemTrackingType === "Serial";
  const isBatch = item?.itemTrackingType === "Batch";
  if (!isSerial && !isBatch) {
    return { data: null, error: "This line is not a tracked item" };
  }
  if (!args.unpick && !line.toStorageUnitId) {
    return {
      data: null,
      error: "No lineside destination is set for this line"
    };
  }

  const type = args.unpick
    ? isSerial
      ? "unpickSerial"
      : "unpickBatch"
    : isSerial
      ? "serial"
      : "batch";

  const body: Record<string, unknown> = {
    type,
    pickingListId: line.pickingListId,
    pickingListLineId: line.id,
    trackedEntityId: args.trackedEntityId,
    locationId: pickingList.locationId,
    userId: args.userId,
    companyId: pickingList.companyId
  };
  if (!args.unpick) {
    body.fromStorageUnitId = args.fromStorageUnitId ?? null;
    if (isBatch) body.quantity = Math.max(1, args.quantity ?? 1);
  }

  const result = await client.functions.invoke("post-picking", { body });
  if (result.error) {
    const ctx = (result.error as { context?: Response })?.context;
    let message = "Failed to pick material";
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.clone().json();
        if (parsed?.message) message = parsed.message;
      } catch {
        /* fall through */
      }
    } else if ((result.error as { message?: string }).message) {
      message = (result.error as { message: string }).message;
    }
    return { data: null, error: message };
  }

  return { data: { id: args.pickingListLineId }, error: null };
}

export async function upsertPickingList(
  client: SupabaseClient<Database>,
  pickingList:
    | (Omit<z.infer<typeof pickingListValidator>, "id" | "pickingListId"> & {
        pickingListId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof pickingListValidator>, "id" | "pickingListId"> & {
        id: string;
        pickingListId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in pickingList) {
    return client
      .from("pickingList")
      .insert([pickingList])
      .select("id")
      .single();
  }
  return client
    .from("pickingList")
    .update({
      ...sanitize(pickingList),
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingList.id)
    .select("id")
    .single();
}

export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId);
}

export async function upsertPickingListLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<z.infer<typeof pickingListLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof pickingListLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in line) {
    return client.from("pickingListLine").insert([line]).select("id").single();
  }
  return client
    .from("pickingListLine")
    .update({
      ...sanitize(line),
      updatedAt: new Date().toISOString()
    })
    .eq("id", line.id)
    .select("id")
    .single();
}

export async function deletePickingList(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client.from("pickingList").delete().eq("id", pickingListId);
}

export async function deletePickingListLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("pickingListLine").delete().eq("id", lineId);
}

// ----------------------------------------------------------------------------
// Picking List Business Logic
// ----------------------------------------------------------------------------

export async function getPickingSchedule(
  client: SupabaseClient<Database>,
  args: {
    locationId: string;
    companyId: string;
    search?: string | null;
  }
) {
  return client.rpc("get_picking_schedule", {
    p_location_id: args.locationId,
    p_company_id: args.companyId,
    p_search: args.search ?? undefined
  });
}

/**
 * On-hand of an item at a location, aggregated per storage unit (bin).
 *
 * `getItemStorageUnitQuantities` can return a row per tracked entity, so we sum
 * to one figure per bin. Computed once per material and reused to (a) decide
 * whether the op's lineside bin is already stocked and (b) resolve a warehouse
 * source by on-hand.
 */
async function getItemOnHandByStorageUnit(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<Map<string, number>> {
  const quantities = await getItemStorageUnitQuantities(
    client,
    args.itemId,
    args.companyId,
    args.locationId
  );

  const byUnit = new Map<string, number>();
  for (const row of quantities.data ?? []) {
    const unitId = (row as { storageUnitId?: string | null }).storageUnitId;
    if (!unitId) continue;
    const qty = Number((row as { quantity?: number | null }).quantity ?? 0);
    byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + qty);
  }
  return byUnit;
}

/**
 * Resolve a WAREHOUSE (non-lineside) source storage unit for a pick by on-hand.
 *
 * Returns the non-lineside storage unit holding the most on-hand of the item at
 * the location, or null when no warehouse stock exists (a shortage — we never
 * source a pick from another work center's lineside bin). A storage unit is
 * "lineside" when it resolves to a work center via `get_effective_work_center_id`.
 */
async function resolveWarehouseSource(
  client: SupabaseClient<Database>,
  onHandByUnit: Map<string, number>
): Promise<string | null> {
  // Consider candidates highest-on-hand first.
  const candidates = Array.from(onHandByUnit.entries())
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [storageUnitId] of candidates) {
    const effectiveWc = await client.rpc("get_effective_work_center_id", {
      p_storage_unit_id: storageUnitId
    });
    // First non-lineside bin (no work center) with the most on-hand wins.
    if (!effectiveWc.data) return storageUnitId;
  }

  return null;
}

export async function generatePickingList(
  client: SupabaseClient<Database>,
  args: {
    jobOperationIds: string[];
    locationId: string;
    companyId: string;
    createdBy: string;
    assignee?: string | null;
    dueDate?: string | null;
  }
) {
  // 1. Get the next sequence number
  const sequenceResult = await getNextSequence(
    client,
    "pickingList",
    args.companyId
  );
  if (sequenceResult.error || !sequenceResult.data) {
    return {
      data: null,
      error: sequenceResult.error ?? "Failed to get sequence"
    };
  }
  const pickingListId = sequenceResult.data as string;

  // 2. Create the picking list header
  const headerInsert = await client
    .from("pickingList")
    .insert([
      {
        pickingListId,
        status: "Draft" as const,
        locationId: args.locationId,
        assignee: args.assignee ?? null,
        dueDate: args.dueDate ?? null,
        companyId: args.companyId,
        createdBy: args.createdBy
      }
    ])
    .select("id, pickingListId")
    .single();

  if (headerInsert.error) {
    return { data: null, error: headerInsert.error };
  }

  const plId = headerInsert.data.id;

  // 3. Get jobMaterial records for those operations with quantityToIssue > 0
  const materials = await client
    .from("jobMaterial")
    .select(
      "id, jobId, jobOperationId, itemId, quantityToIssue, storageUnitId, requiresSerialTracking, requiresBatchTracking"
    )
    .in("jobOperationId", args.jobOperationIds)
    .gt("quantityToIssue", 0);

  if (materials.error) {
    await client.from("pickingList").delete().eq("id", plId);
    return { data: null, error: materials.error };
  }

  // Map each operation to its work center, then lazily resolve (and cache) the
  // lineside destination per work center. A pick is a transfer from the
  // warehouse source to this lineside shelf; production later consumes from it.
  const operations = await client
    .from("jobOperation")
    .select("id, workCenterId")
    .in("id", args.jobOperationIds);

  const workCenterByOperation = new Map<string, string | null>();
  for (const op of operations.data ?? []) {
    workCenterByOperation.set(op.id, op.workCenterId ?? null);
  }

  const linesideByWorkCenter = new Map<string, string | null>();
  const resolveLineside = async (
    workCenterId: string | null
  ): Promise<string | null> => {
    if (!workCenterId) return null;
    if (linesideByWorkCenter.has(workCenterId)) {
      return linesideByWorkCenter.get(workCenterId) ?? null;
    }
    const result = await client.rpc("get_or_create_work_center_lineside", {
      p_work_center_id: workCenterId,
      p_company_id: args.companyId,
      p_user_id: args.createdBy
    });
    const linesideId = (result.data as string | null) ?? null;
    linesideByWorkCenter.set(workCenterId, linesideId);
    return linesideId;
  };

  // Accumulate all line rows and per-material FIFO allocations first, then write
  // them in atomic batch inserts. On any insert error we delete the header,
  // which cascades to lines and tracked-entity allocations (ON DELETE CASCADE),
  // so a partially-built picking list can never survive.
  const lineRows: Array<{
    pickingListId: string;
    jobId: string;
    jobMaterialId: string;
    jobOperationId: string | null;
    itemId: string;
    quantityToPick: number;
    storageUnitId: string | null;
    toStorageUnitId: string | null;
    companyId: string;
    createdBy: string;
  }> = [];
  for (const mat of materials.data ?? []) {
    const quantityToIssue = Number(mat.quantityToIssue ?? 0);
    if (quantityToIssue <= 0) continue;

    const opWorkCenterId = mat.jobOperationId
      ? (workCenterByOperation.get(mat.jobOperationId) ?? null)
      : null;

    // 4. Resolve the destination: the operation's work-center lineside shelf.
    const toStorageUnitId = await resolveLineside(opWorkCenterId);

    // On-hand of this item per bin at the location (computed once, reused below
    // for both the already-staged skip and warehouse-source resolution).
    const onHandByUnit = await getItemOnHandByStorageUnit(client, {
      itemId: mat.itemId,
      locationId: args.locationId,
      companyId: args.companyId
    });

    // Skip when the op's lineside bin already stocks enough to cover the issue —
    // it's already staged here, so there's nothing to pick. We test the ACTUAL
    // on-hand at that bin, not merely whether the jobMaterial's recorded shelf
    // points there: a part can be line-stocked at this work center while the
    // jobMaterial still points at the warehouse (or another line).
    if (
      toStorageUnitId &&
      (onHandByUnit.get(toStorageUnitId) ?? 0) >= quantityToIssue
    ) {
      continue;
    }

    // 5. Determine the source (warehouse) shelf. Use the jobMaterial's shelf
    // only when it's a warehouse (non-lineside) shelf; otherwise resolve a
    // warehouse source by on-hand — never rob another work center's lineside.
    // A null source = a shortage the kitter/planner must resolve.
    let materialEffectiveWc: string | null = null;
    if (mat.storageUnitId) {
      const effectiveWc = await client.rpc("get_effective_work_center_id", {
        p_storage_unit_id: mat.storageUnitId
      });
      materialEffectiveWc = (effectiveWc.data as string | null) ?? null;
    }
    const sourceStorageUnitId =
      mat.storageUnitId && !materialEffectiveWc
        ? mat.storageUnitId
        : await resolveWarehouseSource(client, onHandByUnit);

    lineRows.push({
      pickingListId: plId,
      jobId: mat.jobId,
      jobMaterialId: mat.id,
      jobOperationId: mat.jobOperationId,
      itemId: mat.itemId,
      quantityToPick: quantityToIssue,
      storageUnitId: sourceStorageUnitId,
      toStorageUnitId,
      companyId: args.companyId,
      createdBy: args.createdBy
    });
    // Tracked (serial/batch) lots are intentionally NOT pre-allocated here — the
    // kitter selects them at pick time via the TrackedEntityPicker (smart-ordered,
    // deduped), and the pick records pickingListLineTrackedEntity. Pre-allocating
    // would show un-picked lots as if already picked.
  }

  // 7. If no lines to pick, delete the empty header and report.
  if (lineRows.length === 0) {
    await client.from("pickingList").delete().eq("id", plId);
    return {
      data: null,
      error: "No materials require picking for the selected operations"
    };
  }

  // 8. Atomic batch insert of all lines. Tracked lots are not pre-allocated;
  // they're chosen at pick time via the TrackedEntityPicker.
  const linesInsert = await client
    .from("pickingListLine")
    .insert(lineRows)
    .select("id");

  if (linesInsert.error || !linesInsert.data) {
    await client.from("pickingList").delete().eq("id", plId); // cascade cleanup
    return { data: null, error: linesInsert.error ?? "Failed to create lines" };
  }

  // 9. Return the created picking list
  return {
    data: {
      id: plId,
      pickingListId
    },
    error: null
  };
}

/**
 * Pick, partial-pick (short), or unpick a picking line. A pick TRANSFERS the
 * material from its warehouse source shelf to the work center's lineside shelf
 * via the `post-picking` edge function (consumption happens later at
 * production). The DELTA between the desired picked quantity and what's already
 * picked is what moves: positive transfers in, negative reverses.
 *   - Pick (full):  quantity = quantityToPick
 *   - Unpick:       quantity = 0
 *   - Short:        quantity = whatever was actually picked, markShort = true
 * Tracked items go through the scan flow and are rejected here.
 */
export async function pickPickingListLine(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    quantity: number;
    markShort?: boolean;
    userId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }

  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it to make changes."
    };
  }

  if (
    item?.itemTrackingType === "Serial" ||
    item?.itemTrackingType === "Batch"
  ) {
    return {
      data: null,
      error: "Tracked items must be picked via the scan flow"
    };
  }

  const previouslyPicked = Number(line.quantityPicked ?? 0);
  const target = Math.max(0, args.quantity);
  const delta = target - previouslyPicked;

  if (delta !== 0) {
    // A null source is allowed: the kitter can pick material the system shows no
    // stock for (counts are often wrong) — on-hand simply goes negative at the
    // source until it's reconciled. Only the lineside destination is required.
    if (delta > 0 && !line.toStorageUnitId) {
      return {
        data: null,
        error: "No lineside destination is set for this line"
      };
    }

    const body =
      delta > 0
        ? {
            type: "inventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: pickingList.companyId
          }
        : {
            type: "unpickInventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: -delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: pickingList.companyId
          };

    const result = await client.functions.invoke("post-picking", { body });

    if (result.error) {
      const ctx = (result.error as { context?: Response })?.context;
      let message = "Failed to pick material";
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.clone().json();
          if (parsed?.message) message = parsed.message;
        } catch {
          /* fall through */
        }
      } else if ((result.error as { message?: string }).message) {
        message = (result.error as { message: string }).message;
      }
      return { data: null, error: message };
    }
  }

  // Short overrides the status the edge function derived from quantities.
  if (args.markShort) {
    const update = await client
      .from("pickingListLine")
      .update({
        status: "Short",
        quantityPicked: target,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", line.id);
    if (update.error) {
      return { data: null, error: update.error };
    }
  }

  return { data: { id: line.id }, error: null };
}

export async function insertStockTransfer(
  client: SupabaseClient<Database>,
  input: {
    locationId: string;
    lines: Array<{
      itemId: string;
      fromStorageUnitId?: string | null;
      toStorageUnitId?: string | null;
      quantity?: number;
      requiresSerialTracking?: boolean;
      requiresBatchTracking?: boolean;
    }>;
    companyId: string;
    createdBy: string;
    stockTransferId?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; stockTransferId: string } | null;
  error: PostgrestError | { message: string } | null;
}> {
  const { locationId, lines, companyId, createdBy, customFields } = input;

  let stockTransferId = input.stockTransferId;
  if (!stockTransferId) {
    const sequence = await client.rpc("get_next_sequence", {
      sequence_name: "stockTransfer",
      company_id: companyId
    });
    if (sequence.error || !sequence.data) {
      return {
        data: null,
        error: sequence.error ?? { message: "Failed to get sequence" }
      };
    }
    stockTransferId = sequence.data;
  }

  const linesWithExpandedSerialTracking = lines.reduce<typeof lines>(
    (acc, line) => {
      if (line.quantity && !Number.isInteger(line.quantity)) {
        return acc;
      }
      if (line.requiresSerialTracking && line.quantity && line.quantity > 1) {
        acc.push(
          ...Array.from({ length: line.quantity }, () => ({
            ...line,
            quantity: 1
          }))
        );
      } else {
        acc.push(line);
      }
      return acc;
    },
    []
  );

  const createTransfer = await client
    .from("stockTransfer")
    .insert({
      stockTransferId,
      locationId,
      status: "Released",
      companyId,
      createdBy,
      customFields
    })
    .select("id")
    .single();

  if (createTransfer.error || !createTransfer.data) {
    return { data: null, error: createTransfer.error };
  }

  const createLines = await client.from("stockTransferLine").insert(
    linesWithExpandedSerialTracking.map((line) => ({
      ...line,
      stockTransferId: createTransfer.data.id,
      companyId,
      createdBy
    }))
  );

  if (createLines.error) {
    await client
      .from("stockTransfer")
      .delete()
      .eq("id", createTransfer.data.id);
    return { data: null, error: createLines.error };
  }

  return {
    data: { id: createTransfer.data.id, stockTransferId: stockTransferId! },
    error: null
  };
}

export async function insertWarehouseTransfer(
  client: SupabaseClient<Database>,
  input: {
    fromLocationId: string;
    toLocationId: string;
    companyId: string;
    createdBy: string;
    transferId?: string;
    status?: Database["public"]["Enums"]["warehouseTransferStatus"];
    transferDate?: string;
    expectedReceiptDate?: string;
    notes?: string;
    reference?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; transferId: string } | null;
  error: PostgrestError | { message: string } | null;
}> {
  const {
    fromLocationId,
    toLocationId,
    companyId,
    createdBy,
    status = "Draft",
    transferDate,
    expectedReceiptDate,
    notes,
    reference,
    customFields
  } = input;

  let transferId = input.transferId;
  if (!transferId) {
    const sequence = await client.rpc("get_next_sequence", {
      sequence_name: "warehouseTransfer",
      company_id: companyId
    });
    if (sequence.error || !sequence.data) {
      return {
        data: null,
        error: sequence.error ?? { message: "Failed to get sequence" }
      };
    }
    transferId = sequence.data;
  }

  const createTransfer = await client
    .from("warehouseTransfer")
    .insert({
      transferId,
      fromLocationId,
      toLocationId,
      status,
      transferDate: transferDate || null,
      expectedReceiptDate: expectedReceiptDate || null,
      notes: notes || null,
      reference: reference || null,
      companyId,
      createdBy,
      customFields
    })
    .select("id")
    .single();

  if (createTransfer.error || !createTransfer.data) {
    return { data: null, error: createTransfer.error };
  }

  return {
    data: { id: createTransfer.data.id, transferId: transferId! },
    error: null
  };
}

export async function updateStockTransfer(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    locationId?: string;
    stockTransferId?: string;
    updatedBy: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, customFields, ...fields } = input;
  return client
    .from("stockTransfer")
    .update(
      sanitize({
        ...fields,
        customFields,
        updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function updateWarehouseTransfer(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    fromLocationId?: string;
    toLocationId?: string;
    transferId?: string;
    status?: Database["public"]["Enums"]["warehouseTransferStatus"];
    transferDate?: string;
    expectedReceiptDate?: string;
    notes?: string;
    reference?: string;
    updatedBy: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, customFields, ...fields } = input;
  return client
    .from("warehouseTransfer")
    .update(
      sanitize({
        ...fields,
        customFields,
        updatedBy,
        updatedAt: today(getLocalTimeZone()).toString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}
