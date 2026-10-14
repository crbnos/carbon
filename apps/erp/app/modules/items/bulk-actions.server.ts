// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { chunkArray, datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemBulkUpdateField } from "./items.models";
import { deriveItemMethodUpdate } from "./items.models";
import {
  cascadeItemTrackingType,
  updateItemMethodAndSourcing
} from "./items.service";
import type { InventoryItemType } from "./types";

/**
 * The bulk Update of the item tables (Parts, Materials, Tools, Consumables,
 * Services). Called by `x+/items+/update.tsx` with the selected items and by
 * the background bulk-action job (`~/utils/table-jobs.server`) with up to 100
 * items at a time.
 */

const logger = getLogger("erp", "items-bulk-actions");

export type BulkUpdateItemsResult = {
  /** Items updated. */
  done: number;
  /** Ids that are not an item of the company. */
  skipped: number;
  /** Items whose chunk failed. */
  failed: number;
  /** The first failure's message, or null. */
  error: string | null;
};

/** An `.in()` filter rides in the request URL, so items go 100 at a time. */
const ITEM_BULK_CHUNK = 100;

/**
 * Sets one field on many items. Writes as `client` (the user), and the
 * cascades through `db`. Each chunk commits on its own: a failed chunk leaves
 * the chunks before it applied, and the result counts both, so the caller can
 * say what was done.
 */
export async function bulkUpdateItems(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    field: ItemBulkUpdateField;
    value: string;
    companyId: string;
    userId: string;
  }
): Promise<BulkUpdateItemsResult> {
  const result: BulkUpdateItemsResult = {
    done: 0,
    skipped: 0,
    failed: 0,
    error: null
  };
  const ids = [...new Set(args.itemIds.filter(Boolean))];
  for (const chunk of chunkArray(ids, ITEM_BULK_CHUNK)) {
    // The writes below trust these ids (the itemCost insert names them), so
    // keep only the company's own items.
    const items = await client
      .from("item")
      .select("id")
      .in("id", chunk)
      .eq("companyId", args.companyId);
    if (items.error) {
      logger.error("Failed to read the items of a bulk update", {
        companyId: args.companyId,
        error: items.error
      });
      result.failed += chunk.length;
      result.error ??= items.error.message;
      continue;
    }
    const itemIds = items.data.map((item) => item.id);
    result.skipped += chunk.length - itemIds.length;
    if (itemIds.length === 0) continue;

    const error = await updateItemsChunk(client, db, { ...args, itemIds });
    if (error) {
      logger.error("Failed to bulk update items", {
        companyId: args.companyId,
        field: args.field,
        error
      });
      result.failed += itemIds.length;
      result.error ??= error;
    } else {
      result.done += itemIds.length;
    }
  }
  return result;
}

/** One chunk of `bulkUpdateItems`. Answers the error message, or null. */
async function updateItemsChunk(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    itemIds,
    field,
    value,
    companyId,
    userId
  }: {
    itemIds: string[];
    field: ItemBulkUpdateField;
    value: string;
    companyId: string;
    userId: string;
  }
): Promise<string | null> {
  const updatedAt = datetime.timestamp();
  switch (field) {
    case "itemTrackingType": {
      const newType = value as InventoryItemType;
      const update = await client
        .from("item")
        .update({ itemTrackingType: newType, updatedBy: userId, updatedAt })
        .in("id", itemIds)
        .eq("companyId", companyId);
      if (update.error) return update.error.message;
      try {
        await cascadeItemTrackingType(db, {
          itemIds,
          companyId,
          newType,
          userId
        });
      } catch (err) {
        logger.error("Failed to cascade item tracking type", {
          companyId,
          error: err
        });
        return "Failed to cascade tracking flags";
      }
      return null;
    }
    case "replenishmentSystem":
    case "defaultMethodType":
    case "sourcingType": {
      // These three fields are interlocked and each mirror down to the item's
      // method materials. updateItemMethodAndSourcing applies the item write
      // and the cascade in one transaction, so they can't be left half-applied.
      const { itemUpdate, cascade } = deriveItemMethodUpdate(field, value);
      try {
        await updateItemMethodAndSourcing(db, {
          itemIds,
          companyId,
          userId,
          itemUpdate,
          cascade
        });
      } catch (err) {
        logger.error("Failed to update item method/sourcing", {
          companyId,
          field,
          error: err
        });
        return "Failed to update item";
      }
      return null;
    }
    case "itemPostingGroupId": {
      // One read for the chunk, then one update of the items that have an
      // itemCost row and one insert for the rest.
      const existing = await client
        .from("itemCost")
        .select("itemId")
        .in("itemId", itemIds)
        .eq("companyId", companyId);
      if (existing.error) return existing.error.message;
      const withCost = new Set(existing.data.map((row) => row.itemId));
      const itemPostingGroupId = value || null;

      if (withCost.size > 0) {
        const update = await client
          .from("itemCost")
          .update({ itemPostingGroupId, updatedBy: userId, updatedAt })
          .in("itemId", [...withCost])
          .eq("companyId", companyId);
        if (update.error) return update.error.message;
      }

      const missing = itemIds.filter((itemId) => !withCost.has(itemId));
      if (missing.length > 0) {
        const insert = await client.from("itemCost").insert(
          missing.map((itemId) => ({
            itemId,
            itemPostingGroupId,
            costingMethod: "Standard" as const,
            standardCost: 0,
            unitCost: 0,
            costIsAdjusted: false,
            companyId,
            createdBy: userId,
            updatedBy: userId,
            createdAt: updatedAt,
            updatedAt
          }))
        );
        if (insert.error) return insert.error.message;
      }
      return null;
    }
  }
}
