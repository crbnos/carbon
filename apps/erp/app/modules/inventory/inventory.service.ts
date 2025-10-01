import { fetchAllFromTable, type Database, type Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  batchPropertyOrderValidator,
  batchPropertyValidator,
  inventoryAdjustmentValidator,
  kanbanValidator,
  receiptValidator,
  shelfValidator,
  shipmentValidator,
  shippingMethodValidator,
  warehouseTransferValidator,
} from "./inventory.models";

export async function deleteBatchProperty(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("batchProperty").delete().eq("id", id);
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

export async function deleteShelf(
  client: SupabaseClient<Database>,
  shelfId: string
) {
  return client.from("shelf").delete().eq("id", shelfId);
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
    .select("*, shelf(name)", { count: "exact" })
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
    hasMore: count !== null && offset + pageSize < count,
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
      company_id: companyId,
    },
    {
      count: "exact",
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true },
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
      count: "exact",
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true },
  ]);
  return query;
}

export async function getKanban(
  client: SupabaseClient<Database>,
  kanbanId: string
) {
  return client.from("kanbans").select("*").eq("id", kanbanId).single();
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `receiptId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "receiptId", ascending: false },
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
        lineId,
      }))
  );

  const results = await Promise.all(promises);

  // Check for errors
  const firstError = results.find((result) => result.error);
  if (firstError) {
    return {
      data: [],
      error: firstError.error?.message ?? "Failed to fetch files",
    };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId,
      }))
    ),
    error: null,
  };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  let query = client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("quantity", 1);

  return query;
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
    .gte("quantity", 1);
}

export async function getShelvesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "shelf", "id, name", (query) =>
    query.eq("active", true).eq("companyId", companyId).order("name")
  );
}

export async function getShelvesListForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "shelf", "id, name", (query) =>
    query
      .eq("active", true)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .order("name")
  );
}

export async function getShelves(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("shelf")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
  ]);

  return query;
}

export async function getShelf(
  client: SupabaseClient<Database>,
  shelfId: string
) {
  return client.from("shelf").select("*").eq("id", shelfId).single();
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `shipmentId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "shipmentId", ascending: false },
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
        lineId,
      }))
  );

  const results = await Promise.all(promises);

  // Check for errors
  const firstError = results.find((result) => result.error);
  if (firstError) {
    return {
      data: [],
      error: firstError.error?.message ?? "Failed to fetch files",
    };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId,
      }))
    ),
    error: null,
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
    invoices: invoices.data ?? [],
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,carrier.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .neq("status", "Reserved");

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "sourceDocumentReadableId", ascending: true },
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
      error: jobOperation.error,
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
        count: "exact",
      }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `transferId.ilike.%${args.search}%,reference.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "transferId", ascending: false },
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
      "*, item(*), fromShelf:shelf!fromShelfId(name), toShelf:shelf!toShelfId(name)"
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
  const { adjustmentType, ...rest } = inventoryAdjustment;
  const data = {
    ...rest,
    entryType:
      adjustmentType === "Set Quantity" ? "Positive Adjmt." : adjustmentType, // This will be overwritten below
  };

  const shelfQuantities = await client.rpc(
    "get_item_quantities_by_tracking_id",
    {
      item_id: data.itemId,
      company_id: data.companyId,
      location_id: data.locationId,
    }
  );

  const currentQuantity = inventoryAdjustment.trackedEntityId
    ? shelfQuantities?.data?.find(
        (quantity) =>
          quantity.trackedEntityId == inventoryAdjustment.trackedEntityId
      )
    : shelfQuantities?.data?.find(
        // null == undefined - so we use a == instead of === here
        (quantity) => quantity.shelfId == data.shelfId
      );

  const currentQuantityOnHand = currentQuantity?.quantity ?? 0;

  if (adjustmentType === "Set Quantity" && currentQuantity) {
    const quantityDifference = data.quantity - currentQuantityOnHand;
    if (quantityDifference > 0) {
      data.entryType = "Positive Adjmt.";
      data.quantity = quantityDifference;
    } else if (quantityDifference < 0) {
      data.entryType = "Negative Adjmt.";
      data.quantity = -Math.abs(quantityDifference);
    } else {
      // No change in quantity, we can return early
      return { data: null };
    }
  }

  // Check if it's a negative adjustment and if the quantity is sufficient
  if (data.entryType === "Negative Adjmt.") {
    if (data.quantity > currentQuantityOnHand) {
      return {
        error: "Insufficient quantity for negative adjustment",
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
        })
        .eq("id", inventoryAdjustment.trackedEntityId);

      if (trackedEntityUpdate.error) {
        return trackedEntityUpdate;
      }
    } else {
      const item = await client
        .from("item")
        .select("*")
        .eq("id", data.itemId)
        .single();

      // Create a new tracked entity
      const trackedEntityInsert = await client
        .from("trackedEntity")
        .insert([
          {
            id: inventoryAdjustment.trackedEntityId,
            sourceDocument: "Item",
            sourceDocumentId: data.itemId,
            sourceDocumentReadableId: item.data?.readableIdWithRevision,
            quantity: data.quantity,
            status: "Available",
            companyId: data.companyId,
            createdBy: data.createdBy,
          },
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
          updatedAt: new Date().toISOString(),
        })
      )
      .eq("id", batchProperty.id);
  }

  return client.from("batchProperty").insert({
    ...data,
    createdBy: userId,
  });
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
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", receipt.id)
    .select("id")
    .single();
}

export async function upsertShelf(
  client: SupabaseClient<Database>,
  shelf:
    | (Omit<z.infer<typeof shelfValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shelfValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shelf) {
    return client
      .from("shelf")
      .insert({
        ...shelf,
        id: nanoid(),
      })
      .select("id")
      .single();
  }
  return client
    .from("shelf")
    .update({
      ...sanitize(shelf),
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", shelf.id)
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
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", shipment.id)
    .select("id")
    .single();
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
        ...kanban,
      })
      .select("id")
      .single();
  }
  return client
    .from("kanban")
    .update({
      ...sanitize(kanban),
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", kanban.id)
    .select("id")
    .single();
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
      updatedAt: today(getLocalTimeZone()).toString(),
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
      updatedAt: new Date().toISOString(),
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
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
  } else {
    return client
      .from("warehouseTransferLine")
      .insert({
        ...line,
        createdAt: new Date().toISOString(),
      } as Database["public"]["Tables"]["warehouseTransferLine"]["Insert"])
      .select()
      .single();
  }
}
