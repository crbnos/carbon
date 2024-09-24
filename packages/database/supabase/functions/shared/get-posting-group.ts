import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import { Database } from "../lib/types.ts";

export async function getInventoryPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    itemPostingGroupId: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("postingGroupInventory")
    .select("*")
    .eq("companyId", companyId);

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
  companyId: string,
  args: {
    itemPostingGroupId: string | null;
    supplierTypeId: string | null;
  }
) {
  let query = client
    .from("postingGroupPurchasing")
    .select("*")
    .eq("companyId", companyId);

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

export async function getSalesPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    itemPostingGroupId: string | null;
    customerTypeId: string | null;
  }
) {
  let query = client
    .from("postingGroupSales")
    .select("*")
    .eq("companyId", companyId);

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.customerTypeId === null) {
    query = query.is("customerTypeId", null);
  } else {
    query = query.eq("customerTypeId", args.customerTypeId);
  }

  return await query.single();
}
