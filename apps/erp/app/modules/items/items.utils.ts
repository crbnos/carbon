// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  buildSupplierPriceMap,
  type SupplierPriceBreak,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SupplierPartPricing,
  SupplierPriceMap
} from "../shared/shared.models";
import { lookupBuyPriceFromMap } from "../shared/shared.utils";

const logger = getLogger("erp", "items");

// getNextRevision — numeric → +1, A → …→ Z → AA, AA → AB, etc.
export function getNextRevision(maxRevision: string): string {
  if (/^\d+$/.test(maxRevision)) {
    return (parseInt(maxRevision) + 1).toString();
  } else if (/^[A-Z]{1,2}$/.test(maxRevision)) {
    if (maxRevision.length === 1) {
      return maxRevision === "Z"
        ? "AA"
        : String.fromCharCode(maxRevision.charCodeAt(0) + 1);
    }
    const firstChar = maxRevision[0];
    const secondChar = maxRevision[1];
    if (secondChar === "Z") {
      return String.fromCharCode(firstChar.charCodeAt(0) + 1) + "A";
    }
    return firstChar + String.fromCharCode(secondChar.charCodeAt(0) + 1);
  }
  return maxRevision;
}

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
    logger.error("Failed to get configuration parameters", {
      error: parameters.error
    });
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    logger.error("Failed to get configuration parameter groups", {
      error: groups.error
    });
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

/**
 * Batch pre-fetch supplier pricing for multiple items, for costing.
 * Builds a SupplierPriceMap keyed by itemId, pooling the price breaks of ALL
 * suppliers for each item, converted to base currency per INVENTORY unit at
 * today's exchange rates (`buildSupplierPriceMap`).
 *
 * Used by the quote loader to pre-load pricing data for BOM costing.
 * Mirrored in `packages/database/src/methods.ts`.
 */
export async function getSupplierPriceBreaksForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (!itemIds.length) return {};

  const supplierParts = await client
    .from("supplierPart")
    .select(
      "id, itemId, companyId, currencyCode, conversionFactor, supplierUnitPrice"
    )
    .in("itemId", itemIds);

  if (!supplierParts.data?.length) return {};

  const companyId = supplierParts.data[0].companyId;
  const supplierPartIds = supplierParts.data.map((sp) => sp.id);

  const [prices, rates, company] = await Promise.all([
    client
      .from("supplierPartPrice")
      .select("supplierPartId, quantity, supplierUnitPrice")
      .in("supplierPartId", supplierPartIds)
      .eq("companyId", companyId),
    client.rpc("get_exchange_rates", { p_company_id: companyId }),
    client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single()
  ]);

  const breaksByPart = new Map<string, SupplierPriceBreak[]>();
  for (const price of prices.data ?? []) {
    const breaks = breaksByPart.get(price.supplierPartId) ?? [];
    breaks.push({
      quantity: price.quantity,
      supplierUnitPrice: price.supplierUnitPrice
    });
    breaksByPart.set(price.supplierPartId, breaks);
  }

  return buildSupplierPriceMap(
    supplierParts.data.map((sp) => ({
      itemId: sp.itemId,
      currencyCode: sp.currencyCode,
      conversionFactor: sp.conversionFactor,
      supplierUnitPrice: sp.supplierUnitPrice,
      priceBreaks: breaksByPart.get(sp.id) ?? []
    })),
    Object.fromEntries(
      (rates.data ?? []).map((rate) => [rate.currencyCode, rate.rate])
    ),
    company.data?.baseCurrencyCode ?? "USD"
  );
}

/**
 * Async price lookup across ALL suppliers for an item, in base currency per
 * inventory unit. Delegates to getSupplierPriceBreaksForItems +
 * lookupBuyPriceFromMap.
 *
 * Used in quote creation where the specific supplier isn't known.
 */
export async function lookupBuyPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  qty: number,
  fallbackCost: number
): Promise<number> {
  const map = await getSupplierPriceBreaksForItems(client, [itemId]);
  return lookupBuyPriceFromMap(itemId, qty, map, fallbackCost);
}

/**
 * A supplier part's pricing for a purchase document: its price and breaks as
 * the supplier quoted them (per purchase unit, in the part's currency), with
 * that currency's CURRENT exchange rate, so `resolveSupplierPrice` can convert
 * them into the document's currency. A part in the document's own currency
 * needs no rate; a missing rate is an error, never par.
 */
export async function getSupplierPartPricing(
  client: SupabaseClient<Database>,
  supplierPart: {
    id: string;
    companyId: string;
    currencyCode: string | null;
    supplierUnitPrice: number | null;
  },
  baseCurrencyCode: string,
  documentCurrencyCode: string
): Promise<
  | { data: SupplierPartPricing; error: null }
  | { data: null; error: { message: string } }
> {
  const currencyCode = supplierPartCurrency(
    supplierPart.currencyCode,
    baseCurrencyCode
  );
  const needsRate =
    currencyCode !== baseCurrencyCode && currencyCode !== documentCurrencyCode;

  const [priceBreaks, rate] = await Promise.all([
    getSupplierPartPriceBreaks(client, supplierPart.id),
    needsRate
      ? client.rpc("get_exchange_rate", {
          p_company_id: supplierPart.companyId,
          p_currency_code: currencyCode
        })
      : Promise.resolve({ data: 1, error: null })
  ]);

  if (rate.error || !rate.data) {
    return {
      data: null,
      error: {
        message: rate.error?.message ?? `No exchange rate for ${currencyCode}`
      }
    };
  }

  return {
    data: {
      priceBreaks,
      supplierUnitPrice: supplierPart.supplierUnitPrice,
      currency: { currencyCode, exchangeRate: Number(rate.data) }
    },
    error: null
  };
}

/**
 * Fetch price breaks array for a specific supplier part, as the supplier
 * quoted them: purchase quantity and price per purchase unit, in the supplier
 * part's currency. Used by PO and Invoice forms to cache breaks in state.
 */
export async function getSupplierPartPriceBreaks(
  client: SupabaseClient<Database>,
  supplierPartId: string
): Promise<SupplierPriceBreak[]> {
  const result = await client
    .from("supplierPartPrice")
    .select("quantity, supplierUnitPrice")
    .eq("supplierPartId", supplierPartId)
    .order("quantity", { ascending: true });

  return (result.data ?? []).map((pb) => ({
    quantity: pb.quantity,
    supplierUnitPrice: pb.supplierUnitPrice
  }));
}
