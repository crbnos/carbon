import {
  insertId,
  insertMaybe,
  insertRow,
  nextSequence,
  rows
} from "../sql.ts";
import type { Ctx } from "../types.ts";

// "Fixed Reorder Quantity" with reorderPoint > 0 is the only policy that makes
// a row visible in the planning RPC without demand rows. "Demand-Based Reorder"
// (the default) requires explicit demand and produces quantityToOrder = 0 when
// safetyStockQuantity is 0 (which it is by default).

const BUY_ITEM_IDS = [
  "BAT-LIION-48V",
  "RW-010",
  "ST-050",
  "TXRX-SBAND",
  "THR-HYDRA-1N",
  "TANK-TI-4L"
];

const MAKE_ITEM_IDS = [
  "SAT-1000",
  "BUS-STR-001",
  "EPS-001",
  "ADCS-001",
  "COMMS-001"
];

// Mirrors WEEKS_TO_PROJECT in apps/erp/app/routes/x+/production+/projections.tsx.
// The whole horizon is seeded (not just the weeks that carry demand) so
// getOrCreatePeriods finds every period already present and returns them in the
// order they were inserted — otherwise the loader appends the ones it creates
// and the Week N column headers stop being consecutive.
const WEEKS_TO_PROJECT = 12 * 4;

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// Inventory-tracked, active and already have an itemPlanning row at the Plant.
const DEMAND_PROJECTIONS: { readableId: string; quantities: number[] }[] = [
  { readableId: "SAT-1000", quantities: [2, 2, 3, 3, 4, 4, 5, 5] },
  { readableId: "EPS-001", quantities: [6, 6, 8, 8, 10, 10, 12, 12] },
  { readableId: "ADCS-001", quantities: [3, 4, 4, 5, 6, 6, 8, 8] }
];

export async function runTier12(ctx: Ctx): Promise<void> {
  const { client, companyId, userId, refs } = ctx;
  const plantId = refs.locations.Plant ?? ctx.locationId;
  const paymentTermId = ctx.refs.misc.paymentTermId;
  const shippingMethodId = ctx.refs.shippingMethods["UPS Ground"];

  // ── 1. itemPlanning: Buy items → Fixed Reorder Quantity ─────────────────────
  ctx.log("itemPlanning — Buy items reorder policy");
  for (const readableId of BUY_ITEM_IDS) {
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
  for (const readableId of MAKE_ITEM_IDS) {
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
  const orbsec = refs.customers["ORBSEC Defense"]!;
  const cLocOrbsec = refs.misc["cloc:ORBSEC Defense"] ?? null;
  const batItem = refs.items["BAT-LIION-48V"]!;
  const rwItem = refs.items["RW-010"]!;

  const { rows: dateRows } = await client.query<{ d: string }>(
    `SELECT (CURRENT_DATE + INTERVAL '56 days')::date::text AS d`
  );
  const promisedDate = dateRows[0]?.d ?? "2026-10-01";

  const soId = await nextSequence(ctx, "salesOrder");
  const so = await insertId(ctx, "salesOrder", {
    salesOrderId: soId,
    status: "To Ship",
    customerId: orbsec,
    customerLocationId: cLocOrbsec,
    locationId: plantId,
    currencyCode: "USD",
    orderDate: new Date().toISOString().split("T")[0]
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
    customerId: orbsec,
    customerLocationId: cLocOrbsec,
    companyId
  });
  await insertId(ctx, "salesOrderLine", {
    salesOrderId: so,
    salesOrderLineType: "Part",
    itemId: batItem.id,
    description: batItem.name,
    saleQuantity: 8,
    unitPrice: batItem.unitCost * 1.5,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    methodType: "Pull from Inventory",
    promisedDate,
    status: "Ordered",
    sortOrder: 1
  });
  await insertId(ctx, "salesOrderLine", {
    salesOrderId: so,
    salesOrderLineType: "Part",
    itemId: rwItem.id,
    description: rwItem.name,
    saleQuantity: 4,
    unitPrice: rwItem.unitCost * 1.5,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    methodType: "Pull from Inventory",
    promisedDate,
    status: "Ordered",
    sortOrder: 2
  });
  ctx.refs.documents["so:planning-seed"] = so;

  // ── 4. demandProjection → /x/production/projections ─────────────────────────
  // getOrCreatePeriods(today, WEEKS_TO_PROJECT) keys periods on startDate +
  // periodType = 'Week' with a Sunday start (startOfWeek(..., "en-US")), so the
  // ranges are derived the same way here. `period` has no companyId, so the wipe
  // leaves it alone — look up first, insert only what is missing, chronologically.
  ctx.log("period — weekly planning horizon");
  const weekRanges = await rows<{ startDate: string; endDate: string }>(
    client,
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS "startDate",
            to_char(d::date + 6, 'YYYY-MM-DD') AS "endDate"
       FROM generate_series(
         CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int,
         CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int + ($1::int - 1) * 7,
         INTERVAL '7 days'
       ) AS d`,
    [WEEKS_TO_PROJECT]
  );

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
  for (const spec of DEMAND_PROJECTIONS) {
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
