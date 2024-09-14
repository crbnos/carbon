import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
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
  const data = {
    ...inventoryAdjustment,
    entryType:
      inventoryAdjustment.adjustmentType === "Set Quantity"
        ? "Positive Adjmt."
        : inventoryAdjustment.adjustmentType,
  };

  return client.from("itemLedger").insert([data]).select("*").single();
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
  companyId: string,
  locationId: string,
  args: GenericQueryFilters & {
    search: string | null;
    favorite?: boolean;
    recent?: boolean;
    createdBy?: string;
    active: boolean;
  }
) {
  let query = client
    .from("itemQuantities")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .eq("active", args.active)
    .eq("itemTrackingType", "Inventory");

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args);

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
    .from("receipts")
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
  return client.from("receipts").select("*").eq("id", receiptId).single();
}

export async function getReceiptLines(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receiptLine").select("*").eq("receiptId", receiptId);
}

export async function getShelvesList(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("shelf")
    .select("id, name")
    .eq("active", true)
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
