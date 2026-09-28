import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { requireToolPermission } from "~/services/mcp-guards.server";
import { setItemActive as setItemActiveCommand } from "./items.server";
import { upsertSupplierPartPrices as upsertSupplierPartPricesRow } from "./items.service";

// Items route commands published as MCP tools. Same idiom as
// `sales.mcp.server.ts`: a wrapper re-applies the route's request gate, adapts
// the tool payload and calls the command the route calls. A same-named export
// here SHADOWS the `items.service.ts` export in the published manifest and the
// runtime registry. Server-only: never re-export from the module barrel.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name.

/**
 * Activate or deactivate items, as the items table's Active edit does; activating an item an unreleased change notice created is refused.
 *
 * `itemIds` are item ids (not part numbers). Release the change notice to
 * activate the items it created. Deactivating is always allowed.
 */
export async function setItemActive(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    itemIds: string[];
    active: boolean;
  }
) {
  await requireToolPermission(
    userId,
    companyId,
    "parts",
    "update",
    args.active ? "activate items" : "deactivate items"
  );
  if (!Array.isArray(args.itemIds) || args.itemIds.length === 0) {
    throw new Error("itemIds must list at least one item id.");
  }
  return setItemActiveCommand(client, {
    itemIds: args.itemIds,
    active: args.active,
    companyId,
    userId
  });
}

/**
 * Replace a supplier part's quantity price breaks, as the supplier part form does; an empty list clears them.
 *
 * Each break is `{ quantity, unitPrice, leadTime? }` in the item's inventory
 * unit; quantities must be distinct. Purchase order, invoice and quote pricing
 * read these breaks before falling back to the supplier part's flat
 * `unitPrice`. The write bypasses row-level security, so the caller's
 * `parts` update permission is checked first.
 */
export async function upsertSupplierPartPrices(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    supplierPartId: string;
    priceBreaks: { quantity: number; unitPrice: number; leadTime?: number }[];
  }
) {
  await requireToolPermission(
    userId,
    companyId,
    "parts",
    "update",
    "set supplier part price breaks"
  );
  if (!Array.isArray(args.priceBreaks)) {
    throw new Error("priceBreaks must be a list.");
  }
  return upsertSupplierPartPricesRow(getDatabaseClient(), {
    supplierPartId: args.supplierPartId,
    companyId,
    userId,
    priceBreaks: args.priceBreaks
  });
}
