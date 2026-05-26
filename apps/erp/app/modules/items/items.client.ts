// Client-safe item queries — accept a Supabase client by argument so they
// can run in the browser using the user's session client. Mirrors the
// `main` signatures of the same names; the server-side ALS variants live
// in items.service.server.ts.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupBuyPriceFromMap } from "~/modules/shared/shared.client";
import type {
  PriceBreak,
  SupplierPriceMap
} from "~/modules/shared/shared.models";

export async function getConfigurationParameters(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [parameters, groups] = await Promise.all([
    client
      .from("configurationParameter")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("configurationParameterGroup")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
  ]);

  if (parameters.error) {
    console.error(parameters.error);
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    console.error(groups.error);
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getItemStorageUnitQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client.rpc("get_item_quantities_by_tracking_id", {
    item_id: itemId,
    company_id: companyId,
    location_id: locationId
  });
}

export async function getSupplierPartPriceBreaks(
  client: SupabaseClient<Database>,
  supplierPartId: string
): Promise<PriceBreak[]> {
  const result = await client
    .from("supplierPartPrice")
    .select("quantity, unitPrice")
    .eq("supplierPartId", supplierPartId)
    .order("quantity", { ascending: true });

  return (result.data ?? []).map((pb) => ({
    quantity: pb.quantity,
    unitPrice: pb.unitPrice
  }));
}

export async function getSupplierPriceBreaksForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (!itemIds.length) return {};

  const supplierParts = await client
    .from("supplierPart")
    .select("id, itemId, unitPrice")
    .in("itemId", itemIds);

  if (!supplierParts.data?.length) return {};

  const supplierPartIds = supplierParts.data.map((sp) => sp.id);

  const prices = await client
    .from("supplierPartPrice")
    .select("supplierPartId, quantity, unitPrice")
    .in("supplierPartId", supplierPartIds)
    .order("quantity", { ascending: true });

  const spToItem = new Map<string, string>();
  for (const sp of supplierParts.data) {
    spToItem.set(sp.id, sp.itemId);
  }

  const result: SupplierPriceMap = {};

  for (const sp of supplierParts.data) {
    if (!result[sp.itemId]) {
      result[sp.itemId] = { priceBreaks: [], fallbackUnitPrice: null };
    }
    const current = result[sp.itemId].fallbackUnitPrice;
    if (sp.unitPrice != null && (current === null || sp.unitPrice < current)) {
      result[sp.itemId].fallbackUnitPrice = sp.unitPrice;
    }
  }

  for (const price of prices.data ?? []) {
    const itemId = spToItem.get(price.supplierPartId);
    if (itemId && result[itemId]) {
      result[itemId].priceBreaks.push({
        quantity: price.quantity,
        unitPrice: price.unitPrice
      });
    }
  }

  return result;
}

export async function lookupBuyPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  qty: number,
  fallbackCost: number
): Promise<number> {
  const map = await getSupplierPriceBreaksForItems(client, [itemId]);
  return lookupBuyPriceFromMap(itemId, qty, map, fallbackCost);
}
