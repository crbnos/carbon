// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Depot repair through the RMA, shipping the unit back. A `Repair` line ships
// the customer's own unit: it never entered stock, so the line writes no stock
// ledger, no cost layer and no journal, and its serial stays Consumed. The
// asset goes back In Service at the RMA's site.
// Spec: .ai/specs/2026-10-08-field-service.md (Depot Repair through the RMA).

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Kysely, Transaction } from "kysely";

export type RepairUnit = {
  trackedEntityId: string;
  salesReturnOrderLineId: string;
  quantity: number;
};

/** The RMA lines among a shipment's lines whose disposition is Repair. */
export async function loadRepairLineIds(
  db: Kysely<DB>,
  companyId: string,
  salesReturnOrderLineIds: string[]
): Promise<Set<string>> {
  if (salesReturnOrderLineIds.length === 0) return new Set();
  const lines = await db
    .selectFrom("salesReturnOrderLine")
    .select("id")
    .where("id", "in", salesReturnOrderLineIds)
    .where("disposition", "=", "Repair")
    .where("companyId", "=", companyId)
    .execute();
  return new Set(lines.map((line) => line.id));
}

/**
 * Ships repaired units back, in the posting transaction:
 * 1. Refuses a unit with no Depot Repair order on its line that is Completed
 *    or Closed, or whose asset is no longer At Depot.
 * 2. Writes one `Return Shipment` activity with `At Depot: false`, the units
 *    as its inputs. The serials stay Consumed.
 * 3. Sets the assets In Service at the RMA's site (else their own), shipped
 *    today on this shipment.
 */
export async function shipRepairedUnits(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    today: string;
    shipmentId: string;
    shipmentReadableId: string;
    salesReturnOrderId: string;
    customerLocationId: string | null;
    units: RepairUnit[];
  }
): Promise<void> {
  const { companyId, userId, units } = args;
  if (units.length === 0) return;

  const orders = await trx
    .selectFrom("serviceOrder as so")
    .innerJoin("customerAsset as ca", (join) =>
      join
        .onRef("ca.id", "=", "so.customerAssetId")
        .on("ca.companyId", "=", companyId)
    )
    .select([
      "so.trackedEntityId",
      "so.salesReturnOrderLineId",
      "ca.id as assetId",
      "ca.status as assetStatus"
    ])
    .where("so.type", "=", "Depot Repair")
    .where(
      "so.trackedEntityId",
      "in",
      units.map((unit) => unit.trackedEntityId)
    )
    .where("so.status", "in", ["Completed", "Closed"])
    .where("so.companyId", "=", companyId)
    .forUpdate("ca")
    .execute();

  const assetIds: string[] = [];
  for (const unit of units) {
    const order = orders.find(
      (o) =>
        o.trackedEntityId === unit.trackedEntityId &&
        o.salesReturnOrderLineId === unit.salesReturnOrderLineId
    );
    if (!order) {
      throw new Error(
        "Complete the unit's service order before you ship it back"
      );
    }
    if (order.assetStatus !== "At Depot") {
      throw new Error("A unit on this shipment is not at the depot");
    }
    assetIds.push(order.assetId);
  }

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
        "At Depot": false
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
      units.map((unit) => ({
        trackedActivityId: activity.id,
        trackedEntityId: unit.trackedEntityId,
        quantity: unit.quantity,
        companyId,
        createdBy: userId,
        createdAt: args.today
      }))
    )
    .execute();

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

/**
 * The void of a repair return shipment, in the void transaction: the units'
 * assets go back At Depot. There is no ledger to reverse, and the serials stay
 * Consumed.
 */
export async function unshipRepairedUnits(
  trx: Transaction<DB>,
  args: { companyId: string; userId: string; trackedEntityIds: string[] }
): Promise<void> {
  if (args.trackedEntityIds.length === 0) return;
  await trx
    .updateTable("customerAsset")
    .set({
      status: "At Depot",
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .where("companyId", "=", args.companyId)
    .execute();
}
