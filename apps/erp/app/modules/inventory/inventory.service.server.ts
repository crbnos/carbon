import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getItemStorageUnitQuantities } from "../items/items.service.server";
import type {
  batchPropertyOrderValidator,
  batchPropertyValidator,
  inventoryAdjustmentValidator,
  kanbanValidator,
  receiptValidator,
  shipmentValidator,
  shippingMethodValidator,
  stockTransferLineValidator,
  storageTypeValidator,
  storageUnitValidator,
  warehouseTransferValidator
} from "./inventory.models";
import { stockTransferValidator } from "./inventory.models";
export const deleteBatchProperty = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteBatchProperty(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("batchProperty").delete().eq("id", id);
  }
);

export const deleteKanban = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteKanban(kanbanId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("kanban").delete().eq("id", kanbanId);
  }
);

export const deleteReceipt = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteReceipt(receiptId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("receipt").delete().eq("id", receiptId);
  }
);

export const deleteReceiptLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteReceiptLine(receiptLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("receiptLine").delete().eq("id", receiptLineId);
  }
);

export const deleteStorageUnit = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteStorageUnit(storageUnitId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("storageUnit").delete().eq("id", storageUnitId);
  }
);

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
export async function deleteStorageUnitCascade(storageUnitId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const descendants = await getStorageUnitDescendants(storageUnitId);
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

export const deleteShipment = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteShipment(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("shipment").delete().eq("id", shipmentId);
  }
);

export const deleteShipmentLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteShipmentLine(shipmentLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("shipmentLine").delete().eq("id", shipmentLineId);
  }
);

export const deleteShippingMethod = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteShippingMethod(shippingMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shippingMethod")
      .update({ active: false })
      .eq("id", shippingMethodId);
  }
);

export const deleteStockTransfer = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteStockTransfer(stockTransferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("stockTransfer").delete().eq("id", stockTransferId);
  }
);

export const deleteStockTransferLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteStockTransferLine(stockTransferLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("stockTransferLine")
      .delete()
      .eq("id", stockTransferLineId);
  }
);

export const deleteWarehouseTransfer = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteWarehouseTransfer(transferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("warehouseTransfer").delete().eq("id", transferId);
  }
);

export const deleteWarehouseTransferLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteWarehouseTransferLine(transferLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("warehouseTransferLine")
      .delete()
      .eq("id", transferLineId);
  }
);

export const getItemLedgerPage = mcpTool(
  {
    classification: "READ"
  },
  async function getItemLedgerPage(
    itemId: string,
    locationId: string,
    sortDescending: boolean = false,
    page: number = 1
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getBatchProperties = mcpTool(
  {
    classification: "READ"
  },
  async function getBatchProperties(itemIds: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("batchProperty")
      .select("*")
      .in("itemId", itemIds)
      .eq("companyId", companyId)
      .order("sortOrder");
  }
);

export const getInventoryItems = mcpTool(
  {
    classification: "READ"
  },
  async function getInventoryItems(
    locationId: string,
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getInventoryItemsCount = mcpTool(
  {
    classification: "READ"
  },
  async function getInventoryItemsCount(
    locationId: string,
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getKanbans = mcpTool(
  {
    classification: "READ"
  },
  async function getKanbans(
    locationId: string,
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getKanban = mcpTool(
  {
    classification: "READ"
  },
  async function getKanban(kanbanId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("kanbans").select("*").eq("id", kanbanId).single();
  }
);

export const getStockTransfer = mcpTool(
  {
    classification: "READ"
  },
  async function getStockTransfer(stockTransferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("stockTransfer")
      .select("*")
      .eq("id", stockTransferId)
      .single();
  }
);

export const getStockTransferLine = mcpTool(
  {
    classification: "READ"
  },
  async function getStockTransferLine(stockTransferLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("stockTransferLines")
      .select("*")
      .eq("id", stockTransferLineId)
      .single();
  }
);

export const getStockTransferLines = mcpTool(
  {
    classification: "READ"
  },
  async function getStockTransferLines(stockTransferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("stockTransferLines")
      .select("*")
      .eq("stockTransferId", stockTransferId)
      .order("itemReadableId", { ascending: true })
      .order("createdAt", { ascending: true });
  }
);

export const getStockTransferTracking = mcpTool(
  {
    classification: "READ"
  },
  async function getStockTransferTracking(stockTransferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trackedActivity")
      .select("attributes, trackedActivityInput(trackedEntityId)")
      .eq("sourceDocument", "Stock Transfer")
      .eq("sourceDocumentId", stockTransferId)
      .eq("companyId", companyId);
  }
);

export const getStockTransfers = mcpTool(
  {
    classification: "READ"
  },
  async function getStockTransfers(
    args: GenericQueryFilters & {
      search: string | null;
      locationId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getDefaultStorageUnitOrStorageUnitWithHighestQuantity = mcpTool(
  {
    classification: "READ"
  },
  async function getDefaultStorageUnitOrStorageUnitWithHighestQuantity(
    itemId: string,
    locationId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const pickMethod = await client
      .from("pickMethod")
      .select("defaultStorageUnitId")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (pickMethod.data?.defaultStorageUnitId)
      return pickMethod.data.defaultStorageUnitId;

    const storageUnits = await getItemStorageUnitQuantities(itemId, locationId);

    const storageUnitWithHighestQuantity = storageUnits.data?.reduce(
      (acc, curr) => {
        return acc.quantity > curr.quantity
          ? acc
          : {
              ...curr,
              quantity: acc.quantity,
              storageUnitId: acc.storageUnitId
            };
      },
      { quantity: 0, storageUnitId: null }
    );

    return storageUnitWithHighestQuantity?.storageUnitId ?? null;
  }
);

export const getReceipts = mcpTool(
  {
    classification: "READ"
  },
  async function getReceipts(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getReceipt = mcpTool(
  {
    classification: "READ"
  },
  async function getReceipt(receiptId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("receipt").select("*").eq("id", receiptId).single();
  }
);

export const getReceiptLines = mcpTool(
  {
    classification: "READ"
  },
  async function getReceiptLines(receiptId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("receiptLines").select("*").eq("receiptId", receiptId);
  }
);

export const getReceiptTracking = mcpTool(
  {
    classification: "READ"
  },
  async function getReceiptTracking(receiptId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Receipt", receiptId)
      .eq("companyId", companyId);
  }
);

export const getReceiptLineTracking = mcpTool(
  {
    classification: "READ"
  },
  async function getReceiptLineTracking(receiptLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Receipt Line", receiptLineId)
      .eq("companyId", companyId);
  }
);

export const getReceiptFiles = mcpTool(
  {
    classification: "READ"
  },
  async function getReceiptFiles(
    lineIds: string[]
  ): Promise<{ data: StorageItem[]; error: string | null }> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getSerialNumbersForItem = mcpTool(
  {
    classification: "READ",
    schema: z.object({ args: z.object({ itemId: z.string() }) })
  },
  async function getSerialNumbersForItem(args: { itemId: string }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    let query = client
      .from("trackedEntity")
      .select("*")
      .eq("sourceDocument", "Item")
      .eq("sourceDocumentId", args.itemId)
      .eq("companyId", companyId)
      .eq("quantity", 1);

    return query;
  }
);

export const getBatchNumbersForItem = mcpTool(
  {
    classification: "READ",
    schema: z.object({
      args: z.object({ itemId: z.string(), isReadOnly: z.boolean().optional() })
    })
  },
  async function getBatchNumbersForItem(args: {
    itemId: string;
    isReadOnly?: boolean;
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("sourceDocument", "Item")
      .eq("sourceDocumentId", args.itemId)
      .eq("companyId", companyId)
      .gte("quantity", 1);
  }
);

export const getStorageUnitsList = mcpTool(
  {
    classification: "READ"
  },
  async function getStorageUnitsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return fetchAllFromTable<{
      id: string;
      name: string;
    }>(client, "storageUnit", "id, name", (query) =>
      query.eq("active", true).eq("companyId", companyId).order("name")
    );
  }
);

export const getStorageUnitsListForLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getStorageUnitsListForLocation(locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

// Tree shape from storageUnits_recursive view: each row has its 1-based depth
// and the full ancestorPath (root → node ids). Sort by ancestorPath so the
// caller can render a flat list that visually nests by depth.
export async function getStorageUnitsTreeForLocation(locationId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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

export const getStorageUnits = mcpTool(
  {
    classification: "READ"
  },
  async function getStorageUnits(
    locationId: string,
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getStorageUnit = mcpTool(
  {
    classification: "READ"
  },
  async function getStorageUnit(storageUnitId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("storageUnit")
      .select("*")
      .eq("id", storageUnitId)
      .single();
  }
);

// Roots only (depth = 1). Honors search/filter/pagination so the table can
// paginate top-level storage units while children load lazily on demand.
export async function getStorageUnitRoots(
  locationId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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
export async function getStorageUnitChildren(parentId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  return client
    .from("storageUnits_recursive")
    .select("*")
    .eq("parentId", parentId)
    .order("name");
}

// Set of storageUnit ids that have at least one child in the given location.
// Drives whether the table renders an expand chevron on a row.
export async function getStorageUnitParentIdsWithChildren(locationId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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
  locationId: string,
  search: string
) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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

export const getShipments = mcpTool(
  {
    classification: "READ"
  },
  async function getShipments(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getShipment = mcpTool(
  {
    classification: "READ"
  },
  async function getShipment(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("shipment").select("*").eq("id", shipmentId).single();
  }
);

export const getShipmentLines = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentLines(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shipmentLines")
      .select("*, fulfillment(*, job(*))")
      .eq("shipmentId", shipmentId);
  }
);

export const getShipmentLinesWithDetails = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentLinesWithDetails(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shipmentLines")
      .select("*")
      .eq("shipmentId", shipmentId);
  }
);

export const getShipmentFiles = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentFiles(
    lineIds: string[]
  ): Promise<{ data: StorageItem[]; error: string | null }> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getShipmentRelatedItems = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentRelatedItems(
    shipmentId: string,
    sourceDocumentId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getShipmentTracking = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentTracking(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Shipment", shipmentId)
      .eq("companyId", companyId);
  }
);

export const getShipmentLineTracking = mcpTool(
  {
    classification: "READ"
  },
  async function getShipmentLineTracking(shipmentLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Shipment Line", shipmentLineId)
      .eq("companyId", companyId);
  }
);

export const getShippingMethod = mcpTool(
  {
    classification: "READ"
  },
  async function getShippingMethod(shippingMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shippingMethod")
      .select("*")
      .eq("id", shippingMethodId)
      .single();
  }
);

export const getShippingMethods = mcpTool(
  {
    classification: "READ"
  },
  async function getShippingMethods(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getShippingMethodsList = mcpTool(
  {
    classification: "READ"
  },
  // `companyId` is optional: defaults to the ambient (actor's) company for
  // authed routes. It is an explicit override for public/share routes where
  // no AuthContextHolder is available.
  async function getShippingMethodsList(companyId?: string) {
    const resolvedCompanyId = companyId ?? AuthContextHolder.get().companyId;
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shippingMethod")
      .select("id, name")
      .eq("companyId", resolvedCompanyId)
      .eq("active", true)
      .order("name", { ascending: true });
  }
);

export const getShippingTermsList = mcpTool(
  {
    classification: "READ"
  },
  async function getShippingTermsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("shippingTerm")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name", { ascending: true });
  }
);

export const getTrackedEntities = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntities(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getTrackedEntitiesByMakeMethodId = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntitiesByMakeMethodId(jobMakeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("attributes->>Job Make Method", jobMakeMethodId)
      .order("createdAt", { ascending: true });
  }
);

export const getTrackedEntity = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntity(trackedEntityId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trackedEntity")
      .select("*")
      .eq("id", trackedEntityId)
      .single();
  }
);

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
export async function updateTrackedEntityExpiry(args: {
  trackedEntityId: string;
  expirationDate: string | null;
  reason: string;
  source?: string;
}) {
  const { userId } = AuthContextHolder.get();
  const client = getAuthClient<SupabaseClient<Database>>();
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
        userId: userId,
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

export const getTrackedEntitiesByOperationId = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntitiesByOperationId(operationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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

    return getTrackedEntitiesByMakeMethodId(jobOperation.data.jobMakeMethodId);
  }
);

export const getWarehouseTransfers = mcpTool(
  {
    classification: "READ"
  },
  async function getWarehouseTransfers(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getWarehouseTransfer = mcpTool(
  {
    classification: "READ"
  },
  async function getWarehouseTransfer(transferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("warehouseTransfer")
      .select(
        "*, fromLocation:location!fromLocationId(*), toLocation:location!toLocationId(*)"
      )
      .eq("id", transferId)
      .single();
  }
);

export const getWarehouseTransferLine = mcpTool(
  {
    classification: "READ"
  },
  async function getWarehouseTransferLine(transferId: string, lineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("warehouseTransferLine")
      .select(
        "*, warehouseTransfer(*, fromLocation:location!fromLocationId(name), toLocation:location!toLocationId(name))"
      )
      .eq("id", lineId)
      .eq("transferId", transferId)
      .single();
  }
);

export const getWarehouseTransferLines = mcpTool(
  {
    classification: "READ"
  },
  async function getWarehouseTransferLines(transferId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("warehouseTransferLine")
      .select(
        "*, item(*), fromStorageUnit:storageUnit!fromStorageUnitId(name), toStorageUnit:storageUnit!toStorageUnitId(name)"
      )
      .eq("transferId", transferId);
  }
);

export const insertManualInventoryAdjustment = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertManualInventoryAdjustment(
    inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
      companyId: string;
      createdBy: string;
    }
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
      return updateTrackedEntityExpiry({
        trackedEntityId,
        expirationDate: providedExpirationDate,
        reason: comment?.trim() || "Updated via inventory adjustment",
        source: "Inventory Adjustment"
      });
    };

    const storageUnitQuantities = await client.rpc(
      "get_item_quantities_by_tracking_id",
      {
        item_id: data.itemId,
        company_id: companyId,
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
            companyId: companyId,
            createdBy: userId,
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
            companyId: companyId,
            createdBy: userId,
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
          userId: userId,
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
              companyId: companyId,
              createdBy: userId
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
);

export const updateBatchPropertyOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateBatchPropertyOrder(
    data: Omit<
      z.infer<typeof batchPropertyOrderValidator>,
      "batchPropertyGroupId"
    > & {
      batchPropertyGroupId?: string | null;
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("batchProperty")
      .update(sanitize(data))
      .eq("id", data.id);
  }
);

export const updateStockTransferStatus = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({
        id: z.string(),
        status: z.any(),
        assignee: z.string().nullable().optional(),
        completedAt: z.string().nullable()
      })
    })
  },
  async function updateStockTransferStatus(args: {
    id: string;
    status: Database["public"]["Enums"]["stockTransferStatus"];
    assignee?: string | null;
    completedAt: string | null;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId: updatedBy } = AuthContextHolder.get();
    const { id, status, assignee, completedAt } = args;
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
);

export const upsertBatchProperty = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertBatchProperty(
    batchProperty: z.infer<typeof batchPropertyValidator> & {
      companyId: string;
      userId: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertKanban = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertKanban(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertReceipt = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertReceipt(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertStorageUnit = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertStorageUnit(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertShippingMethod = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertShippingMethod(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertShipment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertShipment(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertStockTransfer = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertStockTransfer(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertStockTransferLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertStockTransferLine(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertStockTransferLines = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({ args: stockTransferValidator })
  },
  async function upsertStockTransferLines(args: {
    lines: z.infer<typeof stockTransferValidator>["lines"];
    stockTransferId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    const { lines, stockTransferId } = args;
    return client.from("stockTransferLine").insert(
      lines.map((line) => ({
        ...line,
        stockTransferId,
        companyId,
        createdBy
      }))
    );
  }
);

export const upsertWarehouseTransfer = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertWarehouseTransfer(
    transfer:
      | (Omit<
          z.infer<typeof warehouseTransferValidator>,
          "id" | "transferId"
        > & {
          transferId: string;
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<
          z.infer<typeof warehouseTransferValidator>,
          "id" | "transferId"
        > & {
          id: string;
          transferId: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateWarehouseTransferStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateWarehouseTransferStatus(
    transferId: string,
    status: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"],
    updatedBy: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("warehouseTransfer")
      .update({
        status,
        updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", transferId);
  }
);

export const upsertWarehouseTransferLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertWarehouseTransferLine(
    line:
      | Database["public"]["Tables"]["warehouseTransferLine"]["Insert"]
      | (Database["public"]["Tables"]["warehouseTransferLine"]["Update"] & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getDefaultStorageUnitForJob = mcpTool(
  {
    classification: "READ"
  },
  async function getDefaultStorageUnitForJob(
    itemId: string,
    locationId: string
  ): Promise<string | null> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
      itemId,
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
);

// ----------------------------------------------------------------------------
// storageUnit hierarchy helpers (backed by the storageUnits_recursive view
// defined in 20260417000200_storage-unit-nesting-and-type.sql)
// ----------------------------------------------------------------------------

export async function getStorageUnitTree(locationId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("ancestorPath");
}

export async function getStorageUnitDescendants(storageUnitId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .contains("ancestorPath", [storageUnitId]);
}

export async function expandStorageUnitIdsWithDescendants(
  storageUnitIds: string[]
): Promise<string[]> {
  const client = getAuthClient<SupabaseClient<Database>>();
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
// storageType CRUD (mirrors materialType in items.service.server.ts)
// ----------------------------------------------------------------------------

export async function getStorageTypeUsage(id: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client
    .from("storageUnit")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .contains("storageTypeIds", [id])
    .limit(5);
}

export async function deleteStorageTypeWithCascade(id: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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
  args?: GenericQueryFilters & { search: string | null }
) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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

export async function getStorageType(id: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  return client.from("storageType").select("*").eq("id", id).single();
}

export async function getStorageTypesList() {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageType", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function upsertStorageType(
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
  const client = getAuthClient<SupabaseClient<Database>>();
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

export async function getShelfLifeForItems(itemIds: string[]) {
  const client = getAuthClient<SupabaseClient<Database>>();
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
  trackedEntityIds: string[]
): Promise<Record<string, string | null>> {
  const client = getAuthClient<SupabaseClient<Database>>();
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
