// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shipping a serviced unit back on its RMA, and the warranty replacement. A
// Return for Service or Return for Warranty line ships the customer's own
// unit: it never entered stock, so the line writes no stock ledger, no cost
// layer and no journal. Its serial, Available while it was at the depot, is
// Consumed again. Its asset goes back In Service at the RMA's site. A sales order line that replaces a Return for
// Warranty line is shipped to warranty expense, not cost of goods sold.
// Spec: .ai/specs/2026-10-22-service-jobs-and-returns.md (The RMA, Postings).

import { InvalidInputError } from "@carbon/api/errors";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";

/** A unit shipped back on a Service or Warranty line. */
export type ServiceUnit = {
  shipmentLineId: string;
  index?: number;
  salesReturnOrderLineId: string;
  /** The unit's serial, else null. */
  trackedEntityId: string | null;
  quantity: number;
};

/** The job statuses a serviced unit can ship back from. A Cancelled job's
 *  unit goes back unrepaired. */
export const SHIP_BACK_JOB_STATUSES = [
  "Completed",
  "Invoiced",
  "Cancelled"
] as const;

/**
 * The job of each RMA line among `salesReturnOrderLineIds`: the newest one
 * not Cancelled, else the newest Cancelled one (as `liveServiceJob`), with its
 * customer asset.
 */
export async function loadReturnLineJobs(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  salesReturnOrderLineIds: string[]
) {
  const byLine = new Map<
    string,
    {
      status: string;
      trackedEntityId: string | null;
      assetId: string | null;
      assetStatus: string | null;
    }
  >();
  if (salesReturnOrderLineIds.length === 0) return byLine;
  const jobs = await db
    .selectFrom("serviceJob as sj")
    .leftJoin("customerAsset as ca", (join) =>
      join
        .onRef("ca.id", "=", "sj.customerAssetId")
        .on("ca.companyId", "=", companyId)
    )
    .select([
      "sj.salesReturnOrderLineId",
      "sj.status",
      "sj.trackedEntityId",
      "ca.id as assetId",
      "ca.status as assetStatus"
    ])
    .where("sj.salesReturnOrderLineId", "in", salesReturnOrderLineIds)
    .where("sj.companyId", "=", companyId)
    .orderBy(sql`"sj"."status" = 'Cancelled'`)
    .orderBy("sj.createdAt", "desc")
    .execute();
  for (const job of jobs) {
    if (!job.salesReturnOrderLineId || byLine.has(job.salesReturnOrderLineId))
      continue;
    byLine.set(job.salesReturnOrderLineId, {
      status: job.status,
      trackedEntityId: job.trackedEntityId,
      assetId: job.assetId,
      assetStatus: job.assetStatus
    });
  }
  return byLine;
}

/** The RMA lines among `salesReturnOrderLineIds` that are Return for Service
 *  or Return for Warranty. */
export async function loadServiceReturnLineIds(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  salesReturnOrderLineIds: string[]
): Promise<Set<string>> {
  if (salesReturnOrderLineIds.length === 0) return new Set();
  const lines = await db
    .selectFrom("salesReturnOrderLine")
    .select("id")
    .where("id", "in", salesReturnOrderLineIds)
    .where("returnType", "in", ["Return for Service", "Return for Warranty"])
    .where("companyId", "=", companyId)
    .execute();
  return new Set(lines.map((line) => line.id));
}

/** The RMA lines among `salesReturnOrderLineIds` that are Return for
 *  Warranty: a sales order line that names one is a warranty replacement. */
export async function loadWarrantyReturnLineIds(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  salesReturnOrderLineIds: string[]
): Promise<Set<string>> {
  if (salesReturnOrderLineIds.length === 0) return new Set();
  const lines = await db
    .selectFrom("salesReturnOrderLine")
    .select("id")
    .where("id", "in", salesReturnOrderLineIds)
    .where("returnType", "=", "Return for Warranty")
    .where("companyId", "=", companyId)
    .execute();
  return new Set(lines.map((line) => line.id));
}

/**
 * Ships serviced units back, in the posting transaction:
 * 1. Refuses a unit whose line's job (the live one, else the latest
 *    Cancelled one) is not Completed, Invoiced or Cancelled, or whose asset
 *    is no longer At Depot.
 * 2. Sets the serials Consumed and writes one `Return Shipment` activity
 *    with `At Depot: false`, the serials as its inputs.
 * 3. Sets the jobs' assets In Service at the RMA's site (else their own),
 *    shipped today on this shipment.
 */
export async function shipServiceUnits(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    today: string;
    shipmentId: string;
    shipmentReadableId: string;
    salesReturnOrderId: string;
    customerLocationId: string | null;
    units: ServiceUnit[];
  }
): Promise<void> {
  const { companyId, userId, units } = args;
  if (units.length === 0) return;

  const jobs = await loadReturnLineJobs(
    trx,
    companyId,
    units.map((unit) => unit.salesReturnOrderLineId)
  );

  const assetIds: string[] = [];
  for (const unit of units) {
    const job = jobs.get(unit.salesReturnOrderLineId);
    if (
      !job ||
      !(SHIP_BACK_JOB_STATUSES as readonly string[]).includes(job.status)
    ) {
      throw new InvalidInputError(
        "Complete the unit's service job before you ship it back"
      );
    }
    if (unit.trackedEntityId && job.trackedEntityId !== unit.trackedEntityId) {
      throw new InvalidInputError(
        "The selected serial is not the unit received on this service job"
      );
    }
    if (job.assetId) {
      if (job.assetStatus !== "At Depot") {
        throw new InvalidInputError(
          "A unit on this shipment is not at the depot"
        );
      }
      assetIds.push(job.assetId);
    }
  }

  const serials = units.filter((unit) => unit.trackedEntityId);
  if (serials.length > 0) {
    const sent = await trx
      .updateTable("trackedEntity")
      .set({ status: "Consumed" })
      .where(
        "id",
        "in",
        serials.map((unit) => unit.trackedEntityId!)
      )
      .where("companyId", "=", companyId)
      .where("status", "=", "Available")
      .where(sql<boolean>`attributes->>'Shipment' = ${args.shipmentId}`)
      .returning("id")
      .execute();
    if (sent.length !== serials.length) {
      throw new InvalidInputError(
        "The selected service serial changed. Refresh the shipment before posting."
      );
    }

    // The unit has no outbound stock row. Remember the stock history
    // observed under its row lock so a later move prevents this shipment's void.
    const stock = await trx
      .selectFrom("itemLedger")
      .select((eb) => eb.fn.max("entryNumber").as("entryNumber"))
      .where("companyId", "=", companyId)
      .where(
        "trackedEntityId",
        "in",
        sent.map((row) => row.id)
      )
      .executeTakeFirstOrThrow();
    const activity = await trx
      .insertInto("trackedActivity")
      .values({
        type: "Return Shipment",
        sourceDocument: "Shipment",
        sourceDocumentId: args.shipmentId,
        sourceDocumentReadableId: args.shipmentReadableId,
        attributes: {
          "Sales Return Order": args.salesReturnOrderId,
          Shipment: args.shipmentId,
          Employee: userId,
          "At Depot": false,
          "Shipment Slots": serials.map((unit) => ({
            id: unit.trackedEntityId!,
            lineId: unit.shipmentLineId,
            index: unit.index
          })),
          "Stock Entry Number": String(stock.entryNumber ?? 0)
        },
        companyId,
        createdBy: userId,
        createdAt: args.today
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("trackedActivityInput")
      .values(
        serials.map((unit) => ({
          trackedActivityId: activity.id,
          trackedEntityId: unit.trackedEntityId!,
          quantity: unit.quantity,
          companyId,
          createdBy: userId,
          createdAt: args.today
        }))
      )
      .execute();
  }

  if (assetIds.length > 0) {
    await trx
      .updateTable("customerAsset")
      .set({
        status: "In Service",
        shippedDate: args.today,
        shipmentId: args.shipmentId,
        customerLocationId: (eb) =>
          eb.fn.coalesce(
            eb.val(args.customerLocationId),
            eb.ref("customerAsset.customerLocationId")
          ),
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", assetIds)
      .where("companyId", "=", companyId)
      .execute();
  }
}

/** Verify the unit is back in its customer's custody, under its existing row lock.
 * A fully reversed receipt of this ship-back is the one allowed intervening movement. */
export async function assertReturnShipmentCustody(
  trx: Transaction<DB>,
  companyId: string,
  shipmentId: string,
  returnOrderId: string,
  unitIds: string[]
) {
  if (!unitIds.length) return;
  const moved = await sql`
    WITH later_receipts AS (
      SELECT DISTINCT r.id, r.status, received."trackedEntityId" AS unit, received.quantity,
        received_activity.attributes @> '{"At Depot": true}'::jsonb AS depot,
        received_activity.attributes->>'Service Job' AS job
      FROM "shipmentLine" original
      JOIN "salesReturnOrderLine" next ON next."shipmentLineId" = original.id AND next."companyId" = original."companyId"
      JOIN "receiptLine" line ON line."lineId" = next.id AND line."companyId" = next."companyId"
      JOIN receipt r ON r.id = line."receiptId" AND r."companyId" = line."companyId"
        AND r."sourceDocument" = 'Sales Return Order' AND r."sourceDocumentId" = next."salesReturnOrderId"
      JOIN "trackedActivity" received_activity ON received_activity."sourceDocumentId" = r.id
        AND received_activity."sourceDocument" = 'Receipt' AND received_activity.type = 'Return Receipt'
        AND received_activity."companyId" = r."companyId"
      JOIN "trackedActivityOutput" received ON received."trackedActivityId" = received_activity.id
        AND received."companyId" = received_activity."companyId"
      WHERE original."companyId" = ${companyId} AND original."shipmentId" = ${shipmentId}
        AND line."receivedQuantity" > 0 AND received."trackedEntityId" = ANY(${unitIds}::text[])
    ), stock_cursor AS (
      SELECT "trackedEntityId" AS unit, "entryNumber" AS cursor FROM "itemLedger"
      WHERE "companyId" = ${companyId} AND "documentType" = 'Sales Return Shipment'
        AND "documentId" = ${shipmentId} AND quantity < 0
      UNION ALL
      SELECT input."trackedEntityId", (activity.attributes->>'Stock Entry Number')::bigint
      FROM "trackedActivity" activity JOIN "trackedActivityInput" input
        ON input."trackedActivityId" = activity.id AND input."companyId" = activity."companyId"
      WHERE activity."companyId" = ${companyId} AND activity."sourceDocument" = 'Shipment'
        AND activity."sourceDocumentId" = ${shipmentId} AND activity.type = 'Return Shipment'
        AND activity.attributes ? 'Stock Entry Number'
    ), later_stock AS (
      SELECT m.* FROM "itemLedger" m
      WHERE m."companyId" = ${companyId} AND m."trackedEntityId" = ANY(${unitIds}::text[]) AND m.quantity <> 0
        AND EXISTS (SELECT 1 FROM stock_cursor c WHERE c.unit = m."trackedEntityId" AND m."entryNumber" > c.cursor)
    )
    SELECT 1 FROM "trackedEntity" u
    WHERE u."companyId" = ${companyId} AND u.id = ANY(${unitIds}::text[]) AND (
      u.status <> 'Consumed' OR u.attributes->>'Shipment' IS DISTINCT FROM ${shipmentId}
      OR EXISTS (SELECT 1 FROM receipt r WHERE r."companyId" = u."companyId"
        AND r.id = u.attributes->>'Receipt' AND r.status = 'Posted'
        AND r."sourceDocument" = 'Sales Return Order' AND r."sourceDocumentId" IS DISTINCT FROM ${returnOrderId})
      -- A depot can receive on another RMA without linking this shipment line.
      -- Its posted receipt retains custody until its own job's unit ships back.
      OR EXISTS (
        SELECT 1 FROM "trackedActivityOutput" arrived
        JOIN "trackedActivity" a ON a.id = arrived."trackedActivityId" AND a."companyId" = arrived."companyId"
        JOIN receipt r ON r.id = a."sourceDocumentId" AND r."companyId" = a."companyId"
        JOIN "serviceJob" job ON job.id = a.attributes->>'Service Job' AND job."companyId" = r."companyId"
        WHERE arrived."companyId" = u."companyId" AND arrived."trackedEntityId" = u.id
          AND a.type = 'Return Receipt' AND a."sourceDocument" = 'Receipt' AND a.attributes @> '{"At Depot": true}'::jsonb
          AND r.status = 'Posted' AND r."sourceDocument" = 'Sales Return Order'
          AND NOT EXISTS (
            SELECT 1 FROM "shipmentLine" slot JOIN shipment s ON s.id = slot."shipmentId" AND s."companyId" = slot."companyId"
            JOIN "trackedActivity" sent ON sent."companyId" = s."companyId" AND sent."sourceDocumentId" = s.id
              AND sent."sourceDocument" = 'Shipment' AND sent.type = 'Return Shipment'
            JOIN "trackedActivityInput" i ON i."companyId" = sent."companyId" AND i."trackedActivityId" = sent.id
            WHERE slot."companyId" = job."companyId" AND slot."lineId" = job."salesReturnOrderLineId"
              AND s.status = 'Posted' AND s."sourceDocument" = 'Sales Return Order' AND s."sourceDocumentId" = r."sourceDocumentId"
              AND i."trackedEntityId" = u.id
          )
      ) OR EXISTS (
        SELECT 1 FROM later_receipts r WHERE r.unit = u.id AND (
          r.status <> 'Voided' OR r.quantity <= 0
          -- Older depot ship-backs lack the stock position needed to recognize
          -- intervening movements when unwinding a later receipt.
          OR NOT EXISTS (SELECT 1 FROM stock_cursor c WHERE c.unit = r.unit)
          OR EXISTS (SELECT 1 FROM "costLedger" cost WHERE cost."companyId" = u."companyId"
            AND cost."documentType" = 'Sales Return Receipt' AND cost."documentId" = r.id
            AND cost."trackedEntityId" = r.unit AND cost."remainingQuantity" <> 0)
          OR NOT EXISTS (
            SELECT 1 FROM "trackedActivity" reversal JOIN "trackedActivityInput" consumed
              ON consumed."trackedActivityId" = reversal.id AND consumed."companyId" = reversal."companyId"
            WHERE reversal."companyId" = u."companyId" AND reversal."sourceDocument" = 'Receipt'
              AND reversal."sourceDocumentId" = r.id AND reversal.type = 'Void Receipt'
              AND consumed."trackedEntityId" = r.unit AND consumed.quantity = r.quantity
          ) OR CASE WHEN r.depot THEN NOT EXISTS (
            SELECT 1 FROM "serviceJob" job LEFT JOIN "customerAsset" asset
              ON asset.id = job."customerAssetId" AND asset."companyId" = job."companyId"
            WHERE job.id = r.job AND job."companyId" = u."companyId" AND job."trackedEntityId" = r.unit
              AND job.status = 'Cancelled' AND (job."customerAssetId" IS NULL OR asset.status = 'In Service')
          ) ELSE (SELECT sum(m.quantity) FROM later_stock m WHERE m."trackedEntityId" = r.unit
            AND m."documentId" = r.id AND m.quantity > 0) IS DISTINCT FROM r.quantity END
        )
      ) OR EXISTS (
        SELECT 1 FROM later_stock m LEFT JOIN later_receipts r
          ON r.unit = m."trackedEntityId" AND r.id = m."documentId"
        WHERE m."trackedEntityId" = u.id
        GROUP BY m."documentId", m."documentLineId", m."itemId", m."locationId", m."storageUnitId", m."projectId", abs(m.quantity)
        HAVING bool_or(r.id IS NULL OR r.depot OR m."documentType" IS DISTINCT FROM 'Sales Return Receipt'
          OR m."entryType" IS DISTINCT FROM (CASE WHEN m.quantity > 0 THEN 'Positive Adjmt.' ELSE 'Negative Adjmt.' END)::"itemLedgerType")
          OR sum(m.quantity) <> 0
          OR max(m."entryNumber") FILTER (WHERE m.quantity > 0) >= min(m."entryNumber") FILTER (WHERE m.quantity < 0)
      )
    ) LIMIT 1
  `.execute(trx);
  if (moved.rows.length)
    throw new InvalidInputError(
      "Cannot void: a unit has moved since this return shipment."
    );
}

/**
 * The void of a ship-back, in the void transaction: the jobs' assets go back
 * At Depot. There is no ledger to reverse. The caller sets the serials back
 * to Available.
 */
export async function unshipServiceUnits(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    shipmentId: string;
    salesReturnOrderLineIds: string[];
  }
): Promise<void> {
  const jobs = await loadReturnLineJobs(
    trx,
    args.companyId,
    args.salesReturnOrderLineIds
  );
  const assetIds = [
    ...new Set(Array.from(jobs.values()).flatMap((job) => job.assetId ?? []))
  ];
  if (!assetIds.length) return;
  const restored = await trx
    .updateTable("customerAsset")
    .set({
      status: "At Depot",
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "in", assetIds)
    .where("shipmentId", "=", args.shipmentId)
    .where("status", "=", "In Service")
    .where("companyId", "=", args.companyId)
    .returning("id")
    .execute();
  if (restored.length !== assetIds.length)
    throw new InvalidInputError(
      "Cannot void: a unit has moved since this return shipment."
    );
}

/**
 * Adds each RMA line's shipped quantity to `quantityShipped` (a void passes
 * negative quantities; the column never goes below 0). One statement.
 */
export async function addReturnLineQuantityShipped(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    shippedByLine: ReadonlyMap<string, number>;
  }
): Promise<void> {
  const rows = [...args.shippedByLine].filter(([, quantity]) => quantity !== 0);
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map(([id, quantity]) => sql`(${id}, ${quantity}::numeric)`)
  );
  await sql`
    UPDATE "salesReturnOrderLine" AS line
    SET "quantityShipped" = GREATEST(0, line."quantityShipped" + v.quantity),
      "updatedBy" = ${args.userId},
      "updatedAt" = NOW()
    FROM (VALUES ${values}) AS v(id, quantity)
    WHERE line."id" = v.id AND line."companyId" = ${args.companyId}
  `.execute(trx);
}
