// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Item sale prices (`itemUnitSalePrice`). Mirrors the Sale Price card on an
// item's Sales tab: `itemUnitSalePriceValidator` (only `unitSalePrice`, 0 or
// more) and `upsertItemUnitSalePrice`, which UPDATEs the item's one row —
// created with the item by its insert trigger. Update only: an item without
// that row is a row error, never an insert.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { Kysely } from "kysely";
import {
  type ImportRecord,
  type ImportSummary,
  type ItemCandidate,
  loadItemIndex,
  numberCell,
  resolveItem
} from "./existing-item";
import { updateRowsByKey } from "./set-based-update";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

// Every item type whose page has a Sales tab with a sale price.
export const SALE_PRICE_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;

export type SalePriceRowDecision =
  | { action: "update"; itemId: string; unitSalePrice: number }
  | { action: "error"; reason: string };

/** One row of the file, checked against the Sales tab's sale price rules. */
export function classifySalePriceRow(params: {
  record: ImportRecord;
  itemIndex: Map<string, ItemCandidate[]>;
  // Items that have their sale price row.
  pricedItemIds: Set<string>;
  // Items already priced by an earlier row of the file.
  seenItemIds: Set<string>;
}): SalePriceRowDecision {
  const { record, itemIndex, pricedItemIds, seenItemIds } = params;
  const item = resolveItem(itemIndex, record, SALE_PRICE_ITEM_TYPES);
  if ("error" in item) return { action: "error", reason: item.error };

  const raw = numberCell(record.unitSalePrice);
  if (raw === undefined) {
    return { action: "error", reason: "Missing required Unit Sale Price" };
  }
  const unitSalePrice = round(raw);
  if (!(unitSalePrice >= 0)) {
    return {
      action: "error",
      reason: "Unit Sale Price must be a number of 0 or more"
    };
  }

  if (!pricedItemIds.has(item.itemId)) {
    return {
      action: "error",
      reason: `Item ${item.readableId} rev ${item.revision} has no sale price record`
    };
  }
  if (seenItemIds.has(item.itemId)) {
    return {
      action: "error",
      reason: `Duplicate sale price for ${item.readableId} rev ${item.revision} in file`
    };
  }
  return { action: "update", itemId: item.itemId, unitSalePrice };
}

/** Updates the sale price of each row's item, in one transaction. */
export async function importItemSalePrices(
  db: Kysely<KyselyDatabase>,
  args: {
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    userId: string;
    summary: ImportSummary;
  }
): Promise<void> {
  const { rows, companyId, userId, summary } = args;

  const itemIndex = await loadItemIndex(
    db,
    companyId,
    rows.map(([, record]) => record)
  );
  const itemIds = [...itemIndex.values()].flat().map((c) => c.id);
  const priced =
    itemIds.length > 0
      ? await db
          .selectFrom("itemUnitSalePrice")
          .select(["itemId"])
          .where("companyId", "=", companyId)
          .where("itemId", "in", itemIds)
          .execute()
      : [];
  const pricedItemIds = new Set(priced.map((p) => p.itemId));

  const seenItemIds = new Set<string>();
  const updates: Array<{ itemId: string; unitSalePrice: number }> = [];
  for (const [row, record] of rows) {
    const decision = classifySalePriceRow({
      record,
      itemIndex,
      pricedItemIds,
      seenItemIds
    });
    if (decision.action === "error") {
      summary.errors.push({ row, reason: decision.reason });
      continue;
    }
    seenItemIds.add(decision.itemId);
    updates.push(decision);
  }

  logger.info({
    function: "import-item-sale-prices",
    totalRecords: rows.length,
    updates: updates.length
  });

  if (updates.length === 0) return;

  await inTransaction(db, async (trx) => {
    await updateRowsByKey(trx, {
      table: "itemUnitSalePrice",
      companyId,
      userId,
      keys: [{ name: "itemId", type: "text" }],
      columns: [{ name: "unitSalePrice", type: "numeric" }],
      rows: updates.map(({ itemId, unitSalePrice }) => ({
        key: { itemId },
        set: { unitSalePrice }
      }))
    });
    summary.updated += updates.length;
  });
}
