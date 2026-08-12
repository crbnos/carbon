import { insertId, insertRow, nextSequence } from "../sql.ts";
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
}
