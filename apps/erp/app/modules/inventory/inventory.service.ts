import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { getNextSequence } from "~/modules/settings";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getItemStorageUnitQuantities } from "../items/items.service";
import type {
  batchPropertyOrderValidator,
  batchPropertyValidator,
  inventoryAdjustmentValidator,
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
    .select("*, storageUnit(name)", { count: "exact" })
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

export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const {
    adjustmentType,
    readableId,
    originalStorageUnitId,
    comment,
    expirationDate: providedExpirationDate,
    ...rest
  } = inventoryAdjustment;
  const data = {
    ...rest,
    entryType:
      adjustmentType === "Set Quantity" ? "Positive Adjmt." : adjustmentType, // This will be overwritten below
    comment: comment || null
  };

  // For new tracked entities created here, fall back to the item's Fixed
  // Duration shelf-life policy when the user did not type an expiry. Other
  // modes (Calculated, Set on Receipt) intentionally stay NULL — they get
  // resolved at production / receipt time, not on a manual adjustment.
  const resolveExpirationForNewEntity = async (): Promise<string | null> => {
    if (providedExpirationDate) return providedExpirationDate;
    const shelfLife = await client
      .from("itemShelfLife")
      .select("mode, days")
      .eq("itemId", inventoryAdjustment.itemId)
      .maybeSingle();
    if (
      !shelfLife.error &&
      shelfLife.data?.mode === "Fixed Duration" &&
      shelfLife.data.days
    ) {
      return today(getLocalTimeZone())
        .add({ days: Number(shelfLife.data.days) })
        .toString();
    }
    return null;
  };

  // For existing tracked entities, only write when the user supplied a value
  // and it differs from the current row. Routes through updateTrackedEntityExpiry
  // so the override is captured in attributes.expiryOverrides for traceability.
  const applyExpirationOverride = async (trackedEntityId: string) => {
    if (!providedExpirationDate) return null;
    const current = await client
      .from("trackedEntity")
      .select("expirationDate")
      .eq("id", trackedEntityId)
      .single();
    if (
      !current.error &&
      current.data?.expirationDate === providedExpirationDate
    )
      return null;
    return updateTrackedEntityExpiry(client, {
      trackedEntityId,
      expirationDate: providedExpirationDate,
      reason: comment?.trim() || "Updated via inventory adjustment",
      source: "Inventory Adjustment",
      userId: data.createdBy
    });
  };

  const storageUnitQuantities = await client.rpc(
    "get_item_quantities_by_tracking_id",
    {
      item_id: data.itemId,
      company_id: data.companyId,
      location_id: data.locationId
    }
  );

  const currentQuantity = inventoryAdjustment.trackedEntityId
    ? storageUnitQuantities?.data?.find(
        (quantity) =>
          quantity.trackedEntityId == inventoryAdjustment.trackedEntityId
      )
    : storageUnitQuantities?.data?.find(
        // null == undefined - so we use a == instead of === here
        (quantity) => quantity.storageUnitId == data.storageUnitId
      );

  const currentQuantityOnHand = currentQuantity?.quantity ?? 0;

  // Check if this is a storage unit transfer for a tracked entity
  const isStorageUnitTransfer =
    inventoryAdjustment.trackedEntityId &&
    originalStorageUnitId &&
    originalStorageUnitId !== data.storageUnitId;

  if (isStorageUnitTransfer) {
    // Handle storage unit transfer: negative adjustment at original unit, positive at new unit
    // First, update the readableId if provided
    if (readableId !== undefined) {
      const trackedEntityUpdate = await client
        .from("trackedEntity")
        .update({ readableId })
        // @ts-expect-error TS2345 - TODO: fix type
        .eq("id", inventoryAdjustment.trackedEntityId);

      if (trackedEntityUpdate.error) {
        return trackedEntityUpdate;
      }
    }

    if (inventoryAdjustment.trackedEntityId) {
      const expiryOverride = await applyExpirationOverride(
        inventoryAdjustment.trackedEntityId
      );
      if (expiryOverride?.error) return expiryOverride;
    }

    // Create negative adjustment at original storage unit
    const negativeAdjustment = await client
      .from("itemLedger")
      .insert([
        {
          itemId: data.itemId,
          locationId: data.locationId,
          storageUnitId: originalStorageUnitId,
          trackedEntityId: inventoryAdjustment.trackedEntityId,
          entryType: "Negative Adjmt." as const,
          quantity: -currentQuantityOnHand,
          companyId: data.companyId,
          createdBy: data.createdBy,
          comment: data.comment
        }
      ])
      .select("*")
      .single();

    if (negativeAdjustment.error) {
      return negativeAdjustment;
    }

    // Create positive adjustment at new storage unit
    return client
      .from("itemLedger")
      .insert([
        {
          itemId: data.itemId,
          locationId: data.locationId,
          storageUnitId: data.storageUnitId,
          trackedEntityId: inventoryAdjustment.trackedEntityId,
          entryType: "Positive Adjmt." as const,
          quantity: currentQuantityOnHand,
          companyId: data.companyId,
          createdBy: data.createdBy,
          comment: data.comment
        }
      ])
      .select("*")
      .single();
  }

  if (adjustmentType === "Set Quantity" && currentQuantity) {
    const quantityDifference = data.quantity - currentQuantityOnHand;
    if (quantityDifference > 0) {
      data.entryType = "Positive Adjmt.";
      data.quantity = quantityDifference;
    } else if (quantityDifference < 0) {
      data.entryType = "Negative Adjmt.";
      data.quantity = -Math.abs(quantityDifference);
    } else {
      // No change in quantity, but readableId / expirationDate might have changed
      if (inventoryAdjustment.trackedEntityId && readableId !== undefined) {
        const trackedEntityUpdate = await client
          .from("trackedEntity")
          .update({ readableId })
          .eq("id", inventoryAdjustment.trackedEntityId);
        if (trackedEntityUpdate.error) return trackedEntityUpdate;
      }
      if (inventoryAdjustment.trackedEntityId) {
        const expiryOverride = await applyExpirationOverride(
          inventoryAdjustment.trackedEntityId
        );
        if (expiryOverride?.error) return expiryOverride;
      }
      return { data: null };
    }
  }

  // Resolve the correct stock target for a negative adjustment when:
  //   - readableId is provided: always resolve via serial number (currentQuantity
  //     may point to the wrong row due to loose null == undefined matching), OR
  //   - No currentQuantity found at all: fall back to untracked (legacy) stock.
  //
  //   1. If readableId is provided, adjust the entity with that serial number that
  //      has positive stock. If not found, return an error — never silently fall back.
  //   2. If no readableId, fall back to untracked (legacy) stock.
  if (
    data.entryType === "Negative Adjmt." &&
    (readableId || !currentQuantity)
  ) {
    if (readableId) {
      // storageUnitQuantities is scoped to this item + location.
      // Filter to positive-qty rows only — multiple entities can share a readableId
      // if the same serial was used across repeated positive adjustments.
      const resolvedQtyRow = storageUnitQuantities?.data?.find(
        (q) =>
          q.readableId === readableId &&
          q.trackedEntityId != null &&
          (q.quantity ?? 0) > 0
      );
      if (!resolvedQtyRow) {
        return { error: "Serial number not found" };
      }
      const resolvedId = resolvedQtyRow.trackedEntityId as string;
      const resolvedQty = resolvedQtyRow.quantity ?? 0;
      if (data.quantity > resolvedQty) {
        return { error: "Insufficient quantity for negative adjustment" };
      }
      const entityUpdate = await client
        .from("trackedEntity")
        .update({ quantity: resolvedQty - data.quantity, readableId })
        .eq("id", resolvedId);
      if (entityUpdate.error) return entityUpdate;
      return client
        .from("itemLedger")
        .insert([
          {
            ...data,
            trackedEntityId: resolvedId,
            quantity: -Math.abs(data.quantity)
          }
        ])
        .select("*")
        .single();
    }
    // No serial number — fall back to legacy (untracked) stock
    const legacyQty =
      storageUnitQuantities?.data?.find(
        (q) =>
          q.trackedEntityId == null && q.storageUnitId == data.storageUnitId
      )?.quantity ?? 0;
    if (data.quantity > legacyQty) {
      return { error: "Insufficient quantity for negative adjustment" };
    }
    return client
      .from("itemLedger")
      .insert([
        { ...data, trackedEntityId: null, quantity: -Math.abs(data.quantity) }
      ])
      .select("*")
      .single();
  }

  // Check if it's a negative adjustment and if the quantity is sufficient
  if (data.entryType === "Negative Adjmt.") {
    if (data.quantity > currentQuantityOnHand) {
      return {
        error: "Insufficient quantity for negative adjustment"
      };
    }
    data.quantity = -Math.abs(data.quantity);
  }

  if (inventoryAdjustment.trackedEntityId) {
    if (currentQuantity) {
      // Update the existing tracked entity
      const trackedEntityUpdate = await client
        .from("trackedEntity")
        .update({
          quantity: data.quantity + currentQuantityOnHand,
          readableId: readableId
        })
        .eq("id", inventoryAdjustment.trackedEntityId);

      if (trackedEntityUpdate.error) {
        return trackedEntityUpdate;
      }

      const expiryOverride = await applyExpirationOverride(
        inventoryAdjustment.trackedEntityId
      );
      if (expiryOverride?.error) return expiryOverride;
    } else {
      const [item, expirationDate] = await Promise.all([
        client.from("item").select("*").eq("id", data.itemId).single(),
        resolveExpirationForNewEntity()
      ]);

      // Stamp the trace blob so the popover Source / Override steps can show
      // the entity originated from a manual inventory adjustment, by whom,
      // and when. Mirrors the receipt/job markers consumed by
      // ExpiryTracePopover (attrs.Receipt, attrs.Job).
      const adjustmentStamp = {
        userId: data.createdBy,
        at: now(getLocalTimeZone()).toAbsoluteString(),
        reason: comment?.trim() || "Created via inventory adjustment"
      };
      const attributes: Record<string, unknown> = {
        "Inventory Adjustment": adjustmentStamp,
        ...(expirationDate
          ? {
              expiryOverrides: [
                {
                  previous: null,
                  next: expirationDate,
                  reason: adjustmentStamp.reason,
                  source: "Inventory Adjustment",
                  userId: adjustmentStamp.userId,
                  at: adjustmentStamp.at
                }
              ]
            }
          : {})
      };

      // Create a new tracked entity
      const trackedEntityInsert = await client
        .from("trackedEntity")
        .insert([
          {
            id: inventoryAdjustment.trackedEntityId,
            sourceDocument: "Item",
            sourceDocumentId: data.itemId,
            sourceDocumentReadableId: item.data?.readableIdWithRevision,
            readableId: readableId,
            quantity: data.quantity,
            status: "Available",
            expirationDate,
            attributes: attributes as unknown as Json,
            companyId: data.companyId,
            createdBy: data.createdBy
          }
        ])
        .select("*")
        .single();

      if (trackedEntityInsert.error) {
        return trackedEntityInsert;
      }
    }
  }

  return client.from("itemLedger").insert([data]).select("*").single();
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
