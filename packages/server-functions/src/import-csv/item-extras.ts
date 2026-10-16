// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The per-item extras an item row can carry besides the item itself: the
// purchasing lead time and the unit cost. The item imports (part, material,
// tool, fixture, consumable, service) and the PART rows of a method import
// fill them by the same rules and write them with the same functions, inside
// the caller's transaction. Supplier parts have their own import
// (supplier-part-import.ts).

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Kysely } from "kysely";
import { MAX_INTEGER, numberCell } from "./existing-item";

export type NumberRule = { label: string; integer: boolean; min: number };

/**
 * The first numeric cell a row holds that its column cannot store, or
 * undefined: not a number, a fraction or a value above `MAX_INTEGER` in a
 * whole-number (INTEGER) column, or below the form's minimum.
 */
export function numberCellsError(
  record: Record<string, string | undefined>,
  rules: Record<string, NumberRule>
): string | undefined {
  for (const [field, rule] of Object.entries(rules)) {
    const value = numberCell(record[field]);
    if (value === undefined) continue;
    if (Number.isNaN(value)) return `${rule.label} must be a number`;
    if (rule.integer && !Number.isInteger(value)) {
      return `${rule.label} must be a whole number`;
    }
    if (rule.integer && value > MAX_INTEGER) {
      return `${rule.label} must be ${MAX_INTEGER} or less`;
    }
    if (value < rule.min) return `${rule.label} must be ${rule.min} or more`;
  }
  return undefined;
}

// The numeric cells of an item row's extras, bounded as the purchasing and
// costing forms bound them; Lead Time is an INTEGER column.
const EXTRA_NUMBERS: Record<string, NumberRule> = {
  leadTime: { label: "Lead Time (Days)", integer: true, min: 0 },
  unitCost: { label: "Unit Cost", integer: false, min: 0 }
};

/**
 * The first numeric extra a row holds that its column cannot store, or
 * undefined. Before this check a fraction was cut to a whole number and a
 * non-number was skipped, both without a report.
 */
export function itemExtrasError(
  record: Record<string, string | undefined>
): string | undefined {
  return numberCellsError(record, EXTRA_NUMBERS);
}

type ItemPurchasingLeadTime = {
  itemId: string;
  leadTime: string;
};

type ItemUnitCost = {
  itemId: string;
  unitCost: string;
};

// Set the item-level purchasing lead time (the "Purchasing" tab field).
// The itemReplenishment row is created by the create_item_related_records
// AFTER INSERT trigger on item (default leadTime 7, per migration
// 20250610000433_demand-planning.sql which renamed purchasingLeadTime →
// leadTime), so within this transaction the row already exists for every
// item we just upserted — we only need to UPDATE it.
async function writeItemPurchasingLeadTimes(
  trx: Kysely<KyselyDatabase>,
  entries: ItemPurchasingLeadTime[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericLeadTime = Number.parseInt(entry.leadTime, 10);
    if (Number.isNaN(numericLeadTime)) continue;
    await trx
      .updateTable("itemReplenishment")
      .set({
        leadTime: numericLeadTime,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

// Set the item-level unit cost (the "Costing" tab field). The itemCost row is
// created by the create_item_related_records AFTER INSERT trigger on item, so
// within this transaction the row already exists for every item we upserted —
// we only need to UPDATE it. Non-numeric/blank values are skipped.
async function writeItemUnitCosts(
  trx: Kysely<KyselyDatabase>,
  entries: ItemUnitCost[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericUnitCost = Number.parseFloat(entry.unitCost);
    if (Number.isNaN(numericUnitCost)) continue;
    await trx
      .updateTable("itemCost")
      .set({
        unitCost: numericUnitCost,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

export type ItemExtras = {
  purchasingLeadTimes: ItemPurchasingLeadTime[];
  unitCosts: ItemUnitCost[];
};

export function emptyItemExtras(): ItemExtras {
  return { purchasingLeadTimes: [], unitCosts: [] };
}

/**
 * Queue the extras one CSV row carries for an item whose id is known: a row
 * with a lead time or a unit cost produces that entry.
 */
export function collectItemExtras(
  extras: ItemExtras,
  itemId: string,
  record: Record<string, string | undefined>
): void {
  if (record.leadTime) {
    extras.purchasingLeadTimes.push({ itemId, leadTime: record.leadTime });
  }
  if (record.unitCost) {
    extras.unitCosts.push({ itemId, unitCost: record.unitCost });
  }
}

/** Write every queued extra, in the order the item import always used. */
export async function writeItemExtras(
  trx: Kysely<KyselyDatabase>,
  extras: ItemExtras,
  companyId: string,
  userId: string
): Promise<void> {
  await writeItemPurchasingLeadTimes(
    trx,
    extras.purchasingLeadTimes,
    companyId,
    userId
  );
  await writeItemUnitCosts(trx, extras.unitCosts, companyId, userId);
}
