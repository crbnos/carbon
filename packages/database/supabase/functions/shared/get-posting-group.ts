import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import { Database } from "../lib/types.ts";

export async function getInventoryPostingGroup(
  client: SupabaseClient<Database>,
  args: {
    itemPostingGroupId: string | null;
    locationId: string | null;
  }
) {
  let query = client.from("postingGroupInventory").select("*");

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.locationId === null) {
    query = query.is("locationId", null);
  } else {
    query = query.eq("locationId", args.locationId);
  }

  return await query.single();
}

export async function getPurchasingPostingGroup(
  client: SupabaseClient<Database>,
  args: {
    itemPostingGroupId: string | null;
    supplierTypeId: string | null;
  }
) {
  let query = client.from("postingGroupPurchasing").select("*");

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.supplierTypeId === null) {
    query = query.is("supplierTypeId", null);
  } else {
    query = query.eq("supplierTypeId", args.supplierTypeId);
  }

  return await query.single();
}
