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
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .gte("quantity", 1);
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
  let query = client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("quantity", 1);

  return query;
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
