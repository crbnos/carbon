import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  inventoryAdjustmentValidator,
  receiptValidator,
  shelfValidator,
  shippingMethodValidator,
} from "./inventory.models";

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

  // Look up the current quantity for this itemId, locationId, and shelfId
  const query = client
    .from("itemInventory")
    .select("quantityOnHand")
    .eq("itemId", data.itemId)
    .eq("locationId", data.locationId);

  if (data.shelfId) {
    query.eq("shelfId", data.shelfId);
  } else {
    query.is("shelfId", null);
  }

  const { data: currentQuantity, error: quantityError } =
    await query.maybeSingle();
  const currentQuantityOnHand = currentQuantity?.quantityOnHand ?? 0;

  if (quantityError) {
    return { error: "Failed to fetch current quantity" };
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

  return client.from("itemLedger").insert([data]).select("*").single();
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

export async function deleteReceipt(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receipt").delete().eq("id", receiptId);
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

export async function getInventoryItems(
  client: SupabaseClient<Database>,
  locationId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc("get_item_quantities", { location_id: locationId });

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
  }

  const includeInactive = args?.filters?.some(
    (filter) =>
      (filter.column === "active" && filter.value === "false") ||
      (filter.column === "active" && filter.operator === "in")
  );
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  query = setGenericQueryFilters(query, args);

  return query;
}

export async function getInventoryItemsCount(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("item")
    .select("id, readableId", { count: "exact" })
    .eq("companyId", companyId)
    .in("itemTrackingType", ["Inventory", "Serial", "Lot"]);

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
  }

  const includeInactive = args?.filters?.some(
    (filter) =>
      (filter.column === "active" && filter.value === "false") ||
      (filter.column === "active" && filter.operator === "in")
  );
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const filteredArgs = {
    ...args,
    filters: args.filters?.filter(
      (filter) =>
        filter.column !== "materialFormId" &&
        filter.column !== "materialSubstanceId"
    ),
  };

  query = setGenericQueryFilters(query, filteredArgs);

  return query;
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
  return client.from("receiptLine").select("*").eq("receiptId", receiptId);
}

export async function getReceiptLineTracking(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client
    .from("receiptLineTracking")
    .select(
      "*, lotNumber(id, number, manufacturingDate, expirationDate), serialNumber(id, number)"
    )
    .eq("receiptId", receiptId);
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

export async function getShelvesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("shelf")
    .select("id, name")
    .eq("active", true)
    .eq("companyId", companyId)
    .order("name");
}

export async function getShelvesListForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return client
    .from("shelf")
    .select("id, name")
    .eq("active", true)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("name");
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
