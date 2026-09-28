import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";
import { commandError } from "~/services/mcp-command-error";
import {
  requireToolCompanyRecord,
  requireToolPermission
} from "~/services/mcp-guards.server";
import type {
  changeNoticeStatus,
  makeMethodVersionValidator
} from "./items.models";
import {
  createMakeMethodVersion,
  setItemActive as setItemActiveCommand,
  transitionChangeNoticeStatus
} from "./items.server";
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

/**
 * Move a change notice to a new status as its status buttons do; Implementation to Done applies the notice (activates its Draft make methods) before closing it.
 *
 * `fromStatus` must be the notice's current status and the move must be one
 * the change-notice workflow allows. Entering Start, Implementation or Done
 * notifies the assignee and action-task assignees. `id` is the notice's uuid.
 */
export async function updateChangeNoticeStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeNoticeStatus)[number];
    toStatus: (typeof changeNoticeStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
) {
  const { id, companyId, updatedBy: userId } = update;
  await requireToolPermission(
    userId,
    companyId,
    "parts",
    "update",
    "change change notice status"
  );
  await requireToolCompanyRecord(
    "changeOrder",
    companyId,
    { id },
    "Change notice"
  );
  const result = await transitionChangeNoticeStatus(
    client,
    getDatabaseClient(),
    {
      id,
      companyId,
      userId,
      fromStatus: update.fromStatus,
      toStatus: update.toStatus,
      assignee: update.assignee
    }
  );
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

/**
 * Create a new make method version as the New Version dialog does: a Draft copy of `copyFromId` including its bill of materials and bill of process.
 *
 * `copyFromId` is the make method (version) to copy; `version` is the new
 * version number. `activeVersionId`, when set, marks that version Active.
 */
export async function upsertMakeMethodVersion(
  client: SupabaseClient<Database>,
  makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const { companyId, createdBy: userId } = makeMethodVersion;
  await requireToolPermission(
    userId,
    companyId,
    "parts",
    "create",
    "create make method versions"
  );
  const result = await createMakeMethodVersion(client, makeMethodVersion);
  if (result.error) {
    return {
      data: result.data,
      error: commandError(
        result.data
          ? `Make method version ${result.data.id} was created, but copying its bill of materials failed`
          : result.error.message,
        result.cause
      )
    };
  }
  return { data: result.data, error: null };
}
