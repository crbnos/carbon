// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Supplier price breaks (`supplierPartPrice`). Mirrors the supplier part
// drawer on an item's Purchasing tab: its Save sends the whole price-break
// ladder, and the edit route deletes the supplier part's ladder and inserts
// the sent one in one transaction, as "Manual Entry" rows. So for every
// (item, supplier) pair in the file, the file's rows ARE that supplier part's
// ladder. A pair without a supplier part gets one first, as the New Supplier
// Part route creates it: the item and the supplier, conversion factor 1.
//
// The drawer refuses to save a ladder with an invalid break, so a pair with
// any bad row is not written at all; its good rows are reported with it.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { Kysely } from "kysely";
import { inChunks } from "./chunks";
import {
  cell,
  type ImportRecord,
  type ImportSummary,
  type ItemCandidate,
  loadItemIndex,
  numberCell,
  resolveItem
} from "./existing-item";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

// Every item type whose page has a Purchasing tab with supplier parts.
export const SUPPLIER_PRICE_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;

export type PriceBreak = {
  itemId: string;
  supplierId: string;
  quantity: number;
  unitPrice: number;
  leadTime: number;
};

export type PriceRowDecision =
  | { action: "price"; pairKey: string; label: string; price: PriceBreak }
  // `pairKey` is set when the row names a known item and supplier, so its
  // error also holds back the rest of that pair's ladder.
  | { action: "error"; reason: string; pairKey?: string };

/** The key of a supplier part: an item and a supplier. */
export const pairKey = (itemId: string, supplierId: string) =>
  `${itemId}::${supplierId}`;

/** One row of the file, checked against the drawer's rules. */
export function classifySupplierPriceRow(
  record: ImportRecord,
  itemIndex: Map<string, ItemCandidate[]>
): PriceRowDecision {
  const item = resolveItem(itemIndex, record, SUPPLIER_PRICE_ITEM_TYPES);
  if ("error" in item) return { action: "error", reason: item.error };

  const supplierId = cell(record.supplierId);
  if (!supplierId)
    return { action: "error", reason: "Missing required Supplier" };

  const key = pairKey(item.itemId, supplierId);
  const label = `${item.readableId} rev ${item.revision}`;
  const error = (reason: string): PriceRowDecision => ({
    action: "error",
    reason,
    pairKey: key
  });

  // Rounded to the stored scale before the check, as the drawer's number
  // inputs commit them: a price that rounds to 0 is a price of 0.
  const rawQuantity = numberCell(record.quantity);
  const quantity = rawQuantity === undefined ? Number.NaN : round(rawQuantity);
  if (!(quantity > 0)) return error("Quantity must be a number greater than 0");

  const rawPrice = numberCell(record.unitPrice);
  const unitPrice = rawPrice === undefined ? Number.NaN : round(rawPrice);
  if (!(unitPrice > 0)) {
    return error("Unit Price must be a number greater than 0");
  }

  // The routes write `leadTime ?? 0`; the drawer sends none.
  const rawLeadTime = numberCell(record.leadTime);
  const leadTime = rawLeadTime === undefined ? 0 : round(rawLeadTime);
  if (!(leadTime >= 0)) return error("Lead Time must be a number of 0 or more");

  return {
    action: "price",
    pairKey: key,
    label,
    price: { itemId: item.itemId, supplierId, quantity, unitPrice, leadTime }
  };
}

export type PriceLadder = {
  itemId: string;
  supplierId: string;
  breaks: Array<PriceBreak & { row: number }>;
};

/**
 * Group the classified rows into one ladder per (item, supplier) pair. A
 * quantity repeated within a pair is an error on the later row, and a pair
 * with any error is dropped whole: its other rows become errors too.
 */
export function planPriceLadders(
  decisions: Array<{ row: number; decision: PriceRowDecision }>
): {
  ladders: PriceLadder[];
  errors: Array<{ row: number; reason: string }>;
} {
  const errors: Array<{ row: number; reason: string }> = [];
  const failedPairs = new Set<string>();
  const ladders = new Map<string, PriceLadder>();
  const labels = new Map<string, string>();

  for (const { row, decision } of decisions) {
    if (decision.action === "error") {
      errors.push({ row, reason: decision.reason });
      if (decision.pairKey) failedPairs.add(decision.pairKey);
      continue;
    }
    const { price } = decision;
    labels.set(decision.pairKey, decision.label);
    const ladder = ladders.get(decision.pairKey) ?? {
      itemId: price.itemId,
      supplierId: price.supplierId,
      breaks: []
    };
    if (ladder.breaks.some((b) => b.quantity === price.quantity)) {
      errors.push({
        row,
        reason: `Duplicate quantity ${price.quantity} for this item and supplier in file`
      });
      failedPairs.add(decision.pairKey);
      continue;
    }
    ladder.breaks.push({ ...price, row });
    ladders.set(decision.pairKey, ladder);
  }

  for (const [key, ladder] of ladders) {
    if (!failedPairs.has(key)) continue;
    for (const priceBreak of ladder.breaks) {
      errors.push({
        row: priceBreak.row,
        reason: `Not imported: another row for ${labels.get(key)} from this supplier has an error, so its price breaks were left as they were`
      });
    }
    ladders.delete(key);
  }

  errors.sort((a, b) => a.row - b.row);
  return { ladders: [...ladders.values()], errors };
}

/**
 * Replaces each item and supplier's price breaks with the file's rows, creating
 * a missing supplier part first, in one transaction.
 */
export async function importSupplierPrices(
  db: Kysely<KyselyDatabase>,
  args: {
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    userId: string;
    summary: ImportSummary;
    /** A break the ladder already had keeps its lead time when the cell is blank. */
    keepSavedValues?: boolean;
  }
): Promise<void> {
  const { rows, companyId, userId, summary, keepSavedValues = false } = args;
  const recordByRow = new Map(rows);

  const itemIndex = await loadItemIndex(
    db,
    companyId,
    rows.map(([, record]) => record)
  );
  const { ladders, errors } = planPriceLadders(
    rows.map(([row, record]) => ({
      row,
      decision: classifySupplierPriceRow(record, itemIndex)
    }))
  );
  summary.errors.push(...errors);

  logger.info({
    function: "import-supplier-prices",
    totalRecords: rows.length,
    ladders: ladders.length,
    errors: errors.length
  });

  if (ladders.length === 0) return;

  const itemIds = [...new Set(ladders.map((l) => l.itemId))];
  const supplierIds = [...new Set(ladders.map((l) => l.supplierId))];
  const existingParts = await db
    .selectFrom("supplierPart")
    .select(["id", "itemId", "supplierId"])
    .where("companyId", "=", companyId)
    .where("itemId", "in", itemIds)
    .where("supplierId", "in", supplierIds)
    .execute();
  const supplierPartByPair = new Map(
    existingParts.map((p) => [pairKey(p.itemId, p.supplierId), p.id])
  );

  // The quantities each existing ladder has now: a file row at one of them
  // replaces that break (updated); any other row adds one (inserted).
  const existingIds = ladders
    .map((l) => supplierPartByPair.get(pairKey(l.itemId, l.supplierId)))
    .filter((id): id is string => !!id);
  const existingBreaks =
    existingIds.length > 0
      ? await db
          .selectFrom("supplierPartPrice")
          .select(["supplierPartId", "quantity", "leadTime"])
          .where("companyId", "=", companyId)
          .where("supplierPartId", "in", existingIds)
          .execute()
      : [];
  const savedLeadTimes = new Map(
    existingBreaks.map((b) => [
      `${b.supplierPartId}::${round(Number(b.quantity))}`,
      Number(b.leadTime)
    ])
  );

  await inTransaction(db, async (trx) => {
    const missing = ladders.filter(
      (l) => !supplierPartByPair.has(pairKey(l.itemId, l.supplierId))
    );
    if (missing.length > 0) {
      const created = await inChunks(missing, (chunk) =>
        trx
          .insertInto("supplierPart")
          .values(
            chunk.map((l) => ({
              itemId: l.itemId,
              supplierId: l.supplierId,
              conversionFactor: 1,
              companyId,
              createdBy: userId
            }))
          )
          .returning(["id", "itemId", "supplierId"])
          .execute()
      );
      for (const part of created) {
        supplierPartByPair.set(pairKey(part.itemId, part.supplierId), part.id);
      }
    }

    if (existingIds.length > 0) {
      await trx
        .deleteFrom("supplierPartPrice")
        .where("companyId", "=", companyId)
        .where("supplierPartId", "in", existingIds)
        .execute();
    }

    const priceRows = ladders.flatMap((ladder) => {
      const supplierPartId = supplierPartByPair.get(
        pairKey(ladder.itemId, ladder.supplierId)
      )!;
      return ladder.breaks.map((b) => {
        const breakKey = `${supplierPartId}::${b.quantity}`;
        const savedLeadTime = savedLeadTimes.get(breakKey);
        if (savedLeadTime !== undefined) {
          summary.updated += 1;
          summary.existingRows?.push(b.row);
        } else {
          summary.inserted += 1;
        }
        const leadTime =
          keepSavedValues &&
          savedLeadTime !== undefined &&
          !cell(recordByRow.get(b.row)?.leadTime)
            ? savedLeadTime
            : b.leadTime;
        // The price is in the supplier part's currency, per purchase unit: an
        // existing part keeps its own, a new one is created in base
        // (currencyCode NULL), as the part import's supplier columns do.
        return {
          supplierPartId,
          quantity: b.quantity,
          supplierUnitPrice: b.unitPrice,
          leadTime,
          sourceType: "Manual Entry" as const,
          companyId,
          createdBy: userId,
          updatedBy: userId
        };
      });
    });
    await inChunks(priceRows, (chunk) =>
      trx.insertInto("supplierPartPrice").values(chunk).execute()
    );
  });
}
