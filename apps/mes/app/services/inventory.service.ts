import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  shelfId: zfd.text(z.string().optional()),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  quantity: zfd.numeric(z.number().min(1, { message: "Quantity is required" })),
});

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material" && item.data.revision !== "0") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .gt("quantity", 0);
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("status", "Available")
    .gt("quantity", 0);
}

export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  // Check if it's a negative adjustment and if the quantity is sufficient
  if (inventoryAdjustment.entryType === "Negative Adjmt.") {
    inventoryAdjustment.quantity = -Math.abs(inventoryAdjustment.quantity);
  }

  return client
    .from("itemLedger")
    .insert([inventoryAdjustment])
    .select("*")
    .single();
}
