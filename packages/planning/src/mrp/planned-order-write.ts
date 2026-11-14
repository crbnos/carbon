// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// MRP v2 Phase 2a: the diff-write of `plannedOrder` in the MRP write phase
// (spec §2a.6). A Planned row is MRP's; it keeps its id while its natural key
// stays, and is written only when a value changed. Firm and Converted rows
// are a person's or a document's, and are never touched.

import type { DB } from "@carbon/database/client";
import { equals } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { toIsoDate } from "../scheduling/date-utils.ts";
import {
  type GeneratedPlannedOrder,
  plannedOrderNaturalKey
} from "./planned-orders.ts";
import { jsonEquals, lockCompanyPlanning } from "./planning-actions.ts";

const BATCH_SIZE = 500;

/** A `plannedOrder` row with status Planned, as the diff reads it. */
export type StoredPlannedOrder = {
  id: string;
  itemId: string;
  locationId: string;
  planningSegmentId: string;
  orderType: string;
  periodId: string;
  splitIndex: number;
  quantity: number;
  scrapQuantity: number;
  dueDate: string;
  releaseDate: string;
  lowLevelCode: number;
  supplierId: string | null;
  quantityTrace: unknown;
};

export type PlannedOrderDiff = {
  inserts: GeneratedPlannedOrder[];
  /** A matched row whose values changed, with the values it takes. */
  updates: { id: string; order: GeneratedPlannedOrder }[];
  deleteIds: string[];
  /** The natural key of every matched row, changed or not, to its id. */
  matchedIds: Map<string, string>;
};

/** A trace as jsonb stores it: a key whose value is undefined is gone. */
function storedJson(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function changed(row: StoredPlannedOrder, order: GeneratedPlannedOrder) {
  return (
    !equals(row.quantity, order.quantity) ||
    !equals(row.scrapQuantity, order.scrapQuantity) ||
    row.dueDate !== order.dueDate ||
    row.releaseDate !== order.releaseDate ||
    row.lowLevelCode !== order.lowLevelCode ||
    (row.supplierId ?? null) !== (order.supplierId ?? null) ||
    !jsonEquals(row.quantityTrace ?? null, storedJson(order.quantityTrace))
  );
}

/**
 * The diff of one run (spec §2a.6), pure.
 *
 * 1. A generated order that matches a Planned row on the natural key
 *    updates the row, only when a value changed. The id stays.
 * 2. A generated order that matches no row is inserted.
 * 3. A Planned row that matches no generated order is deleted, unless it is
 *    held (inside the time fence): a held row keeps its values and gets a
 *    Cancel action instead (§2a.4 rule 3).
 *
 * `existing` holds Planned rows only, so Firm and Converted rows are never
 * matched, updated or deleted. A held row is never matched either: its
 * values are the plan's input this run, not its output.
 */
export function diffPlannedOrders(args: {
  existing: StoredPlannedOrder[];
  generated: GeneratedPlannedOrder[];
  heldPlannedOrderIds: ReadonlySet<string>;
}): PlannedOrderDiff {
  const existingByKey = new Map<string, StoredPlannedOrder>();
  for (const row of args.existing) {
    if (args.heldPlannedOrderIds.has(row.id)) continue;
    existingByKey.set(plannedOrderNaturalKey(row), row);
  }

  const inserts: GeneratedPlannedOrder[] = [];
  const updates: PlannedOrderDiff["updates"] = [];
  const matchedIds = new Map<string, string>();
  const seen = new Set<string>();
  for (const order of args.generated) {
    if (seen.has(order.naturalKey)) continue; // one row per natural key
    seen.add(order.naturalKey);
    const row = existingByKey.get(order.naturalKey);
    if (!row) {
      inserts.push(order);
      continue;
    }
    matchedIds.set(order.naturalKey, row.id);
    if (changed(row, order)) updates.push({ id: row.id, order });
  }

  const deleteIds = args.existing
    .filter(
      (row) =>
        !args.heldPlannedOrderIds.has(row.id) &&
        !matchedIds.has(plannedOrderNaturalKey(row))
    )
    .map((row) => row.id);

  return { inserts, updates, deleteIds, matchedIds };
}

/**
 * Diff-writes the company's Planned rows inside the caller's transaction and
 * returns the id of every generated order by its natural key.
 *
 * It takes the company's planning lock FIRST, before it reads: the ERP's
 * convert (`settleNewSupplyPlanningActions`) takes the same lock, so a
 * planned order is never converted between this read and this write. Call it
 * as the first statement of the transaction, so the lock is taken before any
 * row lock. The read is under the lock too, so a row converted or firmed
 * since the run's own read is not Planned here and is left alone; every
 * DELETE and UPDATE re-checks the status on the row as well.
 *
 * Only the rows at `locationIds` are diffed: the locations the run planned.
 * Set-based: one DELETE, one `UPDATE … FROM (VALUES …)` and one INSERT per
 * 500 rows, each scoped by `companyId`.
 */
export async function writePlannedOrderDiff(
  trx: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    locationIds: string[];
    generated: GeneratedPlannedOrder[];
    heldPlannedOrderIds: string[];
    updatedAt: string;
  }
): Promise<Map<string, string>> {
  const { companyId, userId, updatedAt } = args;
  await lockCompanyPlanning(trx, companyId);
  if (args.locationIds.length === 0) return new Map();

  const locationIds = new Set(args.locationIds);
  const rows = await trx
    .selectFrom("plannedOrder")
    .select([
      "id",
      "itemId",
      "locationId",
      "planningSegmentId",
      "orderType",
      "periodId",
      "splitIndex",
      "quantity",
      "scrapQuantity",
      "dueDate",
      "releaseDate",
      "lowLevelCode",
      "supplierId",
      "quantityTrace"
    ])
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("locationId", "in", args.locationIds)
    .execute();

  const diff = diffPlannedOrders({
    existing: rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      scrapQuantity: Number(row.scrapQuantity),
      dueDate: toIsoDate(row.dueDate)!,
      releaseDate: toIsoDate(row.releaseDate)!
    })),
    generated: args.generated.filter((order) =>
      locationIds.has(order.locationId)
    ),
    heldPlannedOrderIds: new Set(args.heldPlannedOrderIds)
  });

  for (let i = 0; i < diff.deleteIds.length; i += BATCH_SIZE) {
    await trx
      .deleteFrom("plannedOrder")
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .where("id", "in", diff.deleteIds.slice(i, i + BATCH_SIZE))
      .execute();
  }

  for (let i = 0; i < diff.updates.length; i += BATCH_SIZE) {
    const values = sql.join(
      diff.updates
        .slice(i, i + BATCH_SIZE)
        .map(
          ({ id, order }) =>
            sql`(${id}, ${order.quantity}, ${order.scrapQuantity}, ${order.dueDate}, ${order.releaseDate}, ${order.lowLevelCode}, ${order.supplierId}, ${JSON.stringify(
              order.quantityTrace
            )})`
        )
    );
    await sql`
      UPDATE "plannedOrder" AS t
      SET "quantity" = v."quantity"::numeric,
          "scrapQuantity" = v."scrapQuantity"::numeric,
          "dueDate" = v."dueDate"::date,
          "releaseDate" = v."releaseDate"::date,
          "lowLevelCode" = v."lowLevelCode"::integer,
          "supplierId" = v."supplierId"::text,
          "quantityTrace" = v."quantityTrace"::jsonb,
          "updatedBy" = ${userId},
          "updatedAt" = ${updatedAt}
      FROM (VALUES ${values}) AS v("id", "quantity", "scrapQuantity", "dueDate", "releaseDate", "lowLevelCode", "supplierId", "quantityTrace")
      WHERE t."id" = v."id"
        AND t."companyId" = ${companyId}
        AND t."status" = 'Planned'
    `.execute(trx);
  }

  const idByKey = new Map(diff.matchedIds);
  for (let i = 0; i < diff.inserts.length; i += BATCH_SIZE) {
    const inserted = await trx
      .insertInto("plannedOrder")
      .values(
        diff.inserts.slice(i, i + BATCH_SIZE).map((order) => ({
          companyId,
          itemId: order.itemId,
          locationId: order.locationId,
          planningSegmentId: order.planningSegmentId,
          orderType: order.orderType,
          status: "Planned" as const,
          quantity: order.quantity,
          scrapQuantity: order.scrapQuantity,
          quantityTrace: JSON.stringify(order.quantityTrace),
          dueDate: order.dueDate,
          releaseDate: order.releaseDate,
          periodId: order.periodId,
          splitIndex: order.splitIndex,
          lowLevelCode: order.lowLevelCode,
          supplierId: order.supplierId,
          createdBy: userId
        }))
      )
      .returning([
        "id",
        "itemId",
        "locationId",
        "planningSegmentId",
        "orderType",
        "periodId",
        "splitIndex"
      ])
      .execute();
    for (const row of inserted) {
      idByKey.set(plannedOrderNaturalKey(row), row.id);
    }
  }

  return idByKey;
}
