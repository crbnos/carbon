// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The per-item extras an item row can carry besides the item itself: a
// supplier part link, the purchasing lead time, the unit cost and the
// planning order multiple. The item imports (part, material, tool, fixture,
// consumable, service) and the PART rows of a method import fill them by the
// same rules and write them with the same functions, inside the caller's
// transaction.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Kysely } from "kysely";

/**
 * Idempotent supplierPart writes for the part/material/tool/fixture/consumable
 * import flow. One CSV row optionally creates one supplierPart link; re-imports
 * UPDATE the existing row (matched by (itemId, supplierId) per company).
 */
export type SupplierPartImportLink = {
  itemId: string;
  supplierId: string;
  supplierPartId?: string;
  supplierUnitOfMeasureCode?: string;
  minimumOrderQuantity?: string;
  orderMultiple?: string;
  conversionFactor?: string;
  unitPrice?: string;
};

type ItemPurchasingLeadTime = {
  itemId: string;
  leadTime: string;
};

type ItemUnitCost = {
  itemId: string;
  unitCost: string;
};

type ItemPlanningOrderMultiple = {
  itemId: string;
  orderMultiple: string;
};

/**
 * Writes each queued supplier part: an update of the item and supplier's
 * existing one, else an insert.
 */
async function writeSupplierPartLinks(
  trx: Kysely<KyselyDatabase>,
  links: SupplierPartImportLink[],
  companyId: string,
  userId: string
): Promise<void> {
  if (links.length === 0) return;
  const itemIds = [...new Set(links.map((l) => l.itemId))];
  const supplierIds = [...new Set(links.map((l) => l.supplierId))];
  const existing = await trx
    .selectFrom("supplierPart")
    .select(["id", "itemId", "supplierId"])
    .where("itemId", "in", itemIds)
    .where("supplierId", "in", supplierIds)
    .where("companyId", "=", companyId)
    .execute();
  const existingByPair = new Map(
    existing.map((e) => [`${e.itemId}:${e.supplierId}`, e.id])
  );

  const now = datetime.timestamp();
  for (const link of links) {
    const key = `${link.itemId}:${link.supplierId}`;
    const existingId = existingByPair.get(key);
    const numericMOQ = link.minimumOrderQuantity
      ? Number.parseInt(link.minimumOrderQuantity, 10)
      : null;
    const numericOrderMultiple = link.orderMultiple
      ? Number.parseInt(link.orderMultiple, 10)
      : null;
    const numericConversion = link.conversionFactor
      ? Number.parseFloat(link.conversionFactor)
      : 1;
    // The price is in the supplier part's currency: an existing part keeps
    // its own, a new one is created in base (currencyCode NULL), which is
    // what an imported price has always meant.
    const numericPrice = link.unitPrice
      ? Number.parseFloat(link.unitPrice)
      : null;

    if (existingId) {
      await trx
        .updateTable("supplierPart")
        .set({
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          supplierUnitPrice: numericPrice,
          updatedAt: now,
          updatedBy: userId
        })
        .where("id", "=", existingId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      await trx
        .insertInto("supplierPart")
        .values({
          itemId: link.itemId,
          supplierId: link.supplierId,
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          supplierUnitPrice: numericPrice,
          companyId,
          createdBy: userId
        })
        .execute();
    }
  }
}

/**
 * Set the item-level purchasing lead time (the "Purchasing" tab field).
 * The itemReplenishment row is created by the create_item_related_records
 * AFTER INSERT trigger on item (default leadTime 7, per migration
 * 20250610000433_demand-planning.sql which renamed purchasingLeadTime →
 * leadTime), so within this transaction the row already exists for every
 * item we just upserted — we only need to UPDATE it.
 */
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

/**
 * Set the item-level unit cost (the "Costing" tab field). The itemCost row is
 * created by the create_item_related_records AFTER INSERT trigger on item, so
 * within this transaction the row already exists for every item we upserted —
 * we only need to UPDATE it. Non-numeric/blank values are skipped.
 */
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

/**
 * Set the item-level planning order multiple. itemPlanning has one row per
 * (item, location) pair, all created by create_item_related_records at item
 * insert time (SELECT FROM location WHERE companyId = ...). A single UPDATE
 * scoped by itemId + companyId therefore covers every location row for that
 * item — matching the "order multiple is unique across every location"
 * expectation. Mirrors the same CSV value already written to
 * supplierPart.orderMultiple in writeSupplierPartLinks; both are intentionally
 * kept in sync at import time even though they're structurally distinct
 * fields (supplier case-pack vs MRP preferred multiple).
 */
async function writeItemPlanningOrderMultiples(
  trx: Kysely<KyselyDatabase>,
  entries: ItemPlanningOrderMultiple[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericOrderMultiple = Number.parseInt(entry.orderMultiple, 10);
    if (Number.isNaN(numericOrderMultiple) || numericOrderMultiple < 1)
      continue;
    await trx
      .updateTable("itemPlanning")
      .set({
        orderMultiple: numericOrderMultiple,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

export type ItemExtras = {
  supplierPartLinks: SupplierPartImportLink[];
  purchasingLeadTimes: ItemPurchasingLeadTime[];
  unitCosts: ItemUnitCost[];
  planningOrderMultiples: ItemPlanningOrderMultiple[];
};

/** No extras queued yet. */
export function emptyItemExtras(): ItemExtras {
  return {
    supplierPartLinks: [],
    purchasingLeadTimes: [],
    unitCosts: [],
    planningOrderMultiples: []
  };
}

/**
 * Queue the extras one CSV row carries for an item whose id is known. A row
 * with a supplier produces a supplier part link; a row with a lead time, a
 * unit cost or an order multiple produces that entry.
 */
export function collectItemExtras(
  extras: ItemExtras,
  itemId: string,
  record: Record<string, string | undefined>
): void {
  if (record.supplierId) {
    extras.supplierPartLinks.push({
      itemId,
      supplierId: record.supplierId,
      supplierPartId: record.supplierPartId,
      supplierUnitOfMeasureCode: record.supplierUnitOfMeasureCode,
      minimumOrderQuantity: record.minimumOrderQuantity,
      orderMultiple: record.orderMultiple,
      conversionFactor: record.conversionFactor,
      unitPrice: record.unitPrice
    });
  }
  if (record.leadTime) {
    extras.purchasingLeadTimes.push({ itemId, leadTime: record.leadTime });
  }
  if (record.unitCost) {
    extras.unitCosts.push({ itemId, unitCost: record.unitCost });
  }
  if (record.orderMultiple) {
    extras.planningOrderMultiples.push({
      itemId,
      orderMultiple: record.orderMultiple
    });
  }
}

/** Write every queued extra, in the order the item import always used. */
export async function writeItemExtras(
  trx: Kysely<KyselyDatabase>,
  extras: ItemExtras,
  companyId: string,
  userId: string
): Promise<void> {
  await writeSupplierPartLinks(
    trx,
    extras.supplierPartLinks,
    companyId,
    userId
  );
  await writeItemPurchasingLeadTimes(
    trx,
    extras.purchasingLeadTimes,
    companyId,
    userId
  );
  await writeItemPlanningOrderMultiples(
    trx,
    extras.planningOrderMultiples,
    companyId,
    userId
  );
  await writeItemUnitCosts(trx, extras.unitCosts, companyId, userId);
}
