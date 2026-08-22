import { resolveDate, weekRangesFrom } from "../dates.ts";
import {
  insertId,
  insertMaybe,
  insertRow,
  need,
  nextSequence,
  rows
} from "../sql.ts";
import type { Ctx } from "../types.ts";

// "Fixed Reorder Quantity" with reorderPoint > 0 is the only policy that makes
// a row visible in the planning RPC without demand rows. "Demand-Based Reorder"
// (the default) requires explicit demand and produces quantityToOrder = 0 when
// safetyStockQuantity is 0 (which it is by default).

// Mirrors WEEKS_TO_PROJECT in apps/erp/app/routes/x+/production+/projections.tsx.
// The whole horizon is seeded (not just the weeks that carry demand) so
// getOrCreatePeriods finds every period already present and returns them in the
// order they were inserted — otherwise the loader appends the ones it creates
// and the Week N column headers stop being consecutive.
const WEEKS_TO_PROJECT = 12 * 4;

/** Arbitrary but fixed — every seeder must pick the same number to serialize. */
const PERIOD_LOCK_KEY = 4820260813;

export async function runTier12(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.planning;
  const { client, companyId, userId, refs } = ctx;
  const plantId = refs.locations.Plant ?? ctx.locationId;
  const paymentTermId = ctx.refs.misc.paymentTermId;
  const shippingMethodId = need(
    ctx.refs.shippingMethods,
    data.demandOrder.shippingMethod
  );

  // ── 1. itemPlanning: Buy items → Fixed Reorder Quantity ─────────────────────
  ctx.log("itemPlanning — Buy items reorder policy");
  for (const readableId of data.buyItemIds) {
    const item = refs.items[readableId];
    if (!item) {
      ctx.log(`  skip ${readableId} — not in refs`);
      continue;
    }
    await client.query(
      `UPDATE "itemPlanning"
       SET "reorderingPolicy" = 'Fixed Reorder Quantity',
           "reorderPoint"      = 5,
           "reorderQuantity"   = 10,
           "updatedBy"         = $1,
           "updatedAt"         = NOW()
       WHERE "itemId" = $2 AND "companyId" = $3 AND "locationId" = $4`,
      [userId, item.id, companyId, plantId]
    );
  }

  // ── 2. itemPlanning: Make items → Fixed Reorder Quantity ─────────────────────
  ctx.log("itemPlanning — Make items reorder policy");
  for (const readableId of data.makeItemIds) {
    const item = refs.items[readableId];
    if (!item) {
      ctx.log(`  skip ${readableId} — not in refs`);
      continue;
    }
    await client.query(
      `UPDATE "itemPlanning"
       SET "reorderingPolicy" = 'Fixed Reorder Quantity',
           "reorderPoint"      = 3,
           "reorderQuantity"   = 5,
           "updatedBy"         = $1,
           "updatedAt"         = NOW()
       WHERE "itemId" = $2 AND "companyId" = $3 AND "locationId" = $4`,
      [userId, item.id, companyId, plantId]
    );
  }

  // ── 3. Open Sales Order → MRP picks it up as demandActual ───────────────────
  // openSalesOrderLines filters on salesOrder.status IN ('To Ship','To Ship and Invoice').
  // quantityToSend is GENERATED ALWAYS from (saleQuantity - quantitySent) — do not insert it.
  // promisedDate must fall inside the 48-week planning horizon.
  ctx.log("SO — open order for buy-item demand");
  const order = data.demandOrder;
  const customerId = refs.customers[order.customer]!;
  const customerLocationId = refs.misc[`cloc:${order.customer}`] ?? null;

  const promisedDate = resolveDate(ctx.anchor, order.promisedDateOffset);

  const soId = await nextSequence(ctx, "salesOrder");
  const so = await insertId(ctx, "salesOrder", {
    salesOrderId: soId,
    status: order.status,
    customerId,
    customerLocationId,
    locationId: plantId,
    currencyCode: order.currencyCode,
    orderDate: resolveDate(ctx.anchor, 0)
  });
  await insertRow(ctx, "salesOrderPayment", {
    id: so,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "salesOrderShipment", {
    id: so,
    locationId: plantId,
    shippingMethodId,
    customerId,
    customerLocationId,
    companyId
  });
  for (const line of order.lines) {
    const item = refs.items[line.item]!;
    await insertId(ctx, "salesOrderLine", {
      salesOrderId: so,
      salesOrderLineType: line.salesOrderLineType,
      itemId: item.id,
      description: item.name,
      saleQuantity: line.saleQuantity,
      unitPrice: item.unitCost * line.unitPriceMultiplier,
      unitOfMeasureCode: line.unitOfMeasureCode,
      locationId: plantId,
      methodType: line.methodType,
      promisedDate,
      status: line.status,
      sortOrder: line.sortOrder
    });
  }
  ctx.refs.documents[order.ref] = so;

  // ── 4. demandProjection → /x/production/projections ─────────────────────────
  // getOrCreatePeriods(today, WEEKS_TO_PROJECT) keys periods on startDate +
  // periodType = 'Week' with a Sunday start (startOfWeek(..., "en-US")), so the
  // ranges are derived the same way here. `period` has no companyId, so the wipe
  // leaves it alone — look up first, insert only what is missing, chronologically.
  ctx.log("period — weekly planning horizon");
  const weekRanges = weekRangesFrom(ctx.anchor, WEEKS_TO_PROJECT);

  // `period` is global — no companyId, and no unique key on
  // ("periodType","startDate") to conflict against. Two companies onboarding at
  // once would both read zero rows and both insert 48 weeks, giving EVERY tenant
  // duplicate weeks. Serialize the read-then-insert; the lock is transaction
  // scoped, so it releases on COMMIT or ROLLBACK.
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [PERIOD_LOCK_KEY]);

  const existingPeriods = await rows<{ id: string; startDate: string }>(
    client,
    `SELECT id, to_char("startDate", 'YYYY-MM-DD') AS "startDate"
       FROM period
      WHERE "periodType" = 'Week'
        AND "startDate" = ANY($1::date[])`,
    [weekRanges.map((r) => r.startDate)]
  );
  const periodIdByStart = new Map(
    existingPeriods.map((p) => [p.startDate, p.id])
  );

  const periodIds: string[] = [];
  for (const range of weekRanges) {
    let periodId = periodIdByStart.get(range.startDate);
    if (!periodId) {
      periodId = await insertId(ctx, "period", {
        startDate: range.startDate,
        endDate: range.endDate,
        periodType: "Week"
      });
    }
    periodIds.push(periodId);
  }

  ctx.log("demandProjection — weekly forecast for make parts");
  for (const spec of data.demandProjections) {
    const item = refs.items[spec.readableId];
    if (!item) {
      ctx.log(`  skip ${spec.readableId} — not in refs`);
      continue;
    }
    for (let week = 0; week < spec.quantities.length; week++) {
      const periodId = periodIds[week];
      if (!periodId) break;
      // updatedBy is NOT NULL with no default, and insertRow only auto-fills
      // companyId / createdBy.
      await insertMaybe(ctx, "demandProjection", {
        itemId: item.id,
        locationId: plantId,
        periodId,
        forecastQuantity: spec.quantities[week],
        updatedBy: userId
      });
    }
  }

  for (let week = 0; week < 8; week++) {
    const periodId = periodIds[week];
    if (periodId) ctx.refs.misc[`period:week${week + 1}`] = periodId;
  }
}
