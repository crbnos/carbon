// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ServiceContext } from "@carbon/api/service-fn.server";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import {
  type ItemBulkUpdateField,
  itemReplenishmentSystems,
  itemTrackingTypes
} from "~/modules/items/items.models";
import {
  setItemPostingGroup,
  setItemSourcing,
  setItemTrackingType
} from "~/modules/items/items.server";
import { methodType, sourcingType } from "~/modules/shared/shared.models";

/**
 * The background bulk-action job's slices of the items tables' Update
 * (`~/utils/table-jobs.server`). Each chunk runs the items service function
 * the in-request action runs, so the value is checked and the cascades run
 * the same way on both paths.
 */

const logger = getLogger("erp", "item-bulk-actions");

/** An `.in()` filter rides in the request URL, so items go 100 at a time. */
const ITEM_BULK_CHUNK = 100;

const allowedValues: Partial<Record<ItemBulkUpdateField, readonly string[]>> = {
  itemTrackingType: itemTrackingTypes,
  replenishmentSystem: itemReplenishmentSystems,
  defaultMethodType: methodType,
  sourcingType: sourcingType
};

/** Whether `value` is one the field takes. Any item group id (or none) is. */
export function isItemBulkUpdateValue(
  field: ItemBulkUpdateField,
  value: string
) {
  const allowed = allowedValues[field];
  return allowed === undefined || allowed.includes(value);
}

function updateItems(
  ctx: ServiceContext,
  ids: string[],
  field: ItemBulkUpdateField,
  value: string
) {
  switch (field) {
    case "itemTrackingType":
      return setItemTrackingType(ctx, {
        ids,
        itemTrackingType: value as (typeof itemTrackingTypes)[number]
      });
    case "replenishmentSystem":
    case "defaultMethodType":
    case "sourcingType":
      return setItemSourcing(ctx, { ids, [field]: value });
    case "itemPostingGroupId":
      return setItemPostingGroup(ctx, {
        ids,
        itemPostingGroupId: value || null
      });
  }
}

export type BulkUpdateItemsResult = {
  done: number;
  /** Ids that are not the company's items. */
  skipped: number;
  /** Items whose chunk failed. */
  failed: number;
  error: string | null;
};

/**
 * Sets one field on many items, 100 at a time. Each chunk commits on its own:
 * a failed chunk leaves the chunks before it applied, and the result counts
 * both, so the caller can say what was done.
 */
export async function bulkUpdateItems(
  ctx: ServiceContext,
  {
    itemIds,
    field,
    value
  }: { itemIds: string[]; field: ItemBulkUpdateField; value: string }
): Promise<BulkUpdateItemsResult> {
  const companyId = ctx.company.id;
  const result: BulkUpdateItemsResult = {
    done: 0,
    skipped: 0,
    failed: 0,
    error: null
  };
  const ids = [...new Set(itemIds.filter(Boolean))];
  for (const chunk of chunkArray(ids, ITEM_BULK_CHUNK)) {
    // The item group write inserts a cost row for each id, so keep only the
    // company's own items.
    const items = await ctx.asCaller.supabase
      .from("item")
      .select("id")
      .in("id", chunk)
      .eq("companyId", companyId);
    if (items.error) {
      logger.error("Failed to read the items of a bulk update", {
        companyId,
        error: items.error
      });
      result.failed += chunk.length;
      result.error ??= items.error.message;
      continue;
    }
    const owned = items.data.map((item) => item.id);
    result.skipped += chunk.length - owned.length;
    if (owned.length === 0) continue;

    const update = await updateItems(ctx, owned, field, value);
    if (update.error) {
      result.failed += owned.length;
      result.error ??= update.error.message;
    } else {
      result.done += owned.length;
    }
  }
  return result;
}
