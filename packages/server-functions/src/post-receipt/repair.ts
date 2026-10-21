// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Depot repair through the RMA: what the receipt of a `Repair` line writes
// instead of stock. The unit stays the customer's: no stock ledger, no cost
// layer, no journal, and its serial stays Consumed. Each received serial gets
// its customer asset (At Depot) and one Depot Repair service order.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Depot Repair through the RMA).

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder } from "@carbon/database/rows";
import { datetime, openChargeIds } from "@carbon/utils";
import type { Transaction } from "kysely";
import {
  ensureCustomerAssets,
  insertServiceOrder
} from "../lib/service-orders";

type SalesReturnOrder = Database["public"]["Tables"]["salesReturnOrder"]["Row"];

export type RepairSerial = {
  trackedEntityId: string;
  serial: string;
  itemId: string;
  salesReturnOrderLineId: string;
  /** The receiving location, which does the repair. */
  locationId: string | null;
};

/**
 * Creates the Depot Repair orders of a repair receipt, in the posting
 * transaction:
 * 1. Refuses a serial that already has an open service order (one open order
 *    per serial).
 * 2. Finds or creates each serial's customer asset and sets it At Depot.
 * 3. Creates one Draft Depot Repair order per serial, with the RMA's customer,
 *    site and contact, the receiving location, and the customer's only Active
 *    contract as its coverage contract.
 * 4. Writes a `Return Receipt` activity per serial with `At Depot` and the
 *    order's id, and the serial as its output.
 */
export async function createDepotRepairOrders(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    receiptId: string;
    receiptReadableId: string;
    today: string;
    salesReturnOrder: SalesReturnOrder;
    serials: RepairSerial[];
  }
): Promise<void> {
  const { companyId, userId, salesReturnOrder, serials } = args;
  const serialIds = serials.map((s) => s.trackedEntityId);

  const [open, customer, contracts] = await inOrder([
    () =>
      trx
        .selectFrom("serviceOrder")
        .select(["serviceOrderId", "trackedEntityId"])
        .where("trackedEntityId", "in", serialIds)
        .where("companyId", "=", companyId)
        .where("status", "not in", ["Closed", "Cancelled"])
        .execute(),
    () =>
      trx
        .selectFrom("customer")
        .select("name")
        .where("id", "=", salesReturnOrder.customerId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow(),
    () =>
      trx
        .selectFrom("customerContract")
        .select(["id", "projectId"])
        .where("customerId", "=", salesReturnOrder.customerId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Active")
        // A project contract never covers a repair; coverage is a service contract's.
        .where("billingBasis", "=", "Schedule")
        .execute()
  ]);
  if (open.length > 0) {
    const serialById = new Map(serials.map((s) => [s.trackedEntityId, s]));
    const first = open[0]!;
    throw new Error(
      `Serial ${serialById.get(first.trackedEntityId)?.serial ?? first.trackedEntityId} has an open service order (${first.serviceOrderId}). Close or cancel it before you receive the unit for repair.`
    );
  }
  const contract = contracts.length === 1 ? contracts[0]! : null;

  const assetBySerial = await ensureCustomerAssets(trx, {
    companyId,
    userId,
    trackedEntityIds: serialIds,
    customerId: salesReturnOrder.customerId,
    customerLocationId: salesReturnOrder.customerLocationId
  });
  await trx
    .updateTable("customerAsset")
    .set({
      status: "At Depot",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "in", [...assetBySerial.values()])
    .where("companyId", "=", companyId)
    .execute();

  for (const serial of serials) {
    if (!serial.locationId) {
      throw new Error("The receipt has no location to repair the unit at");
    }
    const order = await insertServiceOrder(trx, {
      companyId,
      userId,
      type: "Depot Repair",
      trackedEntityId: serial.trackedEntityId,
      serial: serial.serial,
      itemId: serial.itemId,
      customerAssetId: assetBySerial.get(serial.trackedEntityId)!,
      customerId: salesReturnOrder.customerId,
      customerName: customer.name,
      customerLocationId: salesReturnOrder.customerLocationId,
      customerContactId: salesReturnOrder.customerContactId,
      locationId: serial.locationId,
      customerContractId: contract?.id ?? null,
      contractProjectId: contract?.projectId ?? null,
      salesReturnOrderLineId: serial.salesReturnOrderLineId
    });

    const activity = await trx
      .insertInto("trackedActivity")
      .values({
        type: "Return Receipt",
        sourceDocument: "Receipt",
        sourceDocumentId: args.receiptId,
        sourceDocumentReadableId: args.receiptReadableId,
        attributes: {
          "Sales Return Order": salesReturnOrder.id,
          Receipt: args.receiptId,
          Employee: userId,
          "At Depot": true,
          "Service Order": order.id
        },
        companyId,
        createdBy: userId,
        createdAt: args.today
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("trackedActivityOutput")
      .values({
        trackedActivityId: activity.id,
        trackedEntityId: serial.trackedEntityId,
        quantity: 1,
        companyId,
        createdBy: userId,
        createdAt: args.today
      })
      .execute();
  }
}

/**
 * The void of a repair receipt, in the void transaction (plan decision B4).
 * The receipt's Depot Repair orders (its serials on its RMA lines) are
 * cancelled with their open visits, their projects closed, and their assets
 * set back In Service. Refused when an order has a charge that is not
 * reversed, or its unit has already shipped back. The serials stay Consumed:
 * the void's own entity reset already writes that.
 */
export async function voidDepotRepairOrders(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    salesReturnOrderLineIds: string[];
    trackedEntityIds: string[];
  }
): Promise<void> {
  const { companyId, userId } = args;
  if (
    args.salesReturnOrderLineIds.length === 0 ||
    args.trackedEntityIds.length === 0
  ) {
    return;
  }

  const orders = await trx
    .selectFrom("serviceOrder as so")
    .leftJoin("customerAsset as ca", (join) =>
      join
        .onRef("ca.id", "=", "so.customerAssetId")
        .on("ca.companyId", "=", companyId)
    )
    .select([
      "so.id",
      "so.serviceOrderId",
      "so.projectId",
      "so.customerAssetId",
      "ca.status as assetStatus"
    ])
    .where("so.type", "=", "Depot Repair")
    .where("so.salesReturnOrderLineId", "in", args.salesReturnOrderLineIds)
    .where("so.trackedEntityId", "in", args.trackedEntityIds)
    .where("so.status", "!=", "Cancelled")
    .where("so.companyId", "=", companyId)
    .forUpdate("so")
    .execute();
  if (orders.length === 0) return;

  const ledger = await trx
    .selectFrom("projectLedger")
    .select(["id", "reversalOfId", "projectId"])
    .where(
      "projectId",
      "in",
      orders.map((order) => order.projectId)
    )
    .where("companyId", "=", companyId)
    .execute();
  const open = new Set(openChargeIds(ledger));
  const charged = orders.find((order) =>
    ledger.some((row) => row.projectId === order.projectId && open.has(row.id))
  );
  if (charged) {
    throw new Error(
      `Service order ${charged.serviceOrderId} has posted charges. Reverse them before you void this receipt.`
    );
  }
  const shipped = orders.find(
    (order) => order.assetStatus !== null && order.assetStatus !== "At Depot"
  );
  if (shipped) {
    throw new Error(
      `The unit of service order ${shipped.serviceOrderId} is no longer at the depot. Void its return shipment before you void this receipt.`
    );
  }

  const now = datetime.timestamp();
  const orderIds = orders.map((order) => order.id);
  await trx
    .updateTable("serviceVisit")
    .set({ status: "Cancelled", updatedBy: userId, updatedAt: now })
    .where("serviceOrderId", "in", orderIds)
    .where("status", "in", ["Scheduled", "Traveling", "On Site"])
    .where("companyId", "=", companyId)
    .execute();
  await trx
    .updateTable("serviceOrder")
    .set({
      status: "Cancelled",
      completedAt: null,
      completedBy: null,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "in", orderIds)
    .where("companyId", "=", companyId)
    .execute();
  await trx
    .updateTable("project")
    .set({ status: "Closed", updatedBy: userId, updatedAt: now })
    .where(
      "id",
      "in",
      orders.map((order) => order.projectId)
    )
    .where("companyId", "=", companyId)
    .execute();
  const assetIds = orders
    .map((order) => order.customerAssetId)
    .filter((id): id is string => Boolean(id));
  if (assetIds.length > 0) {
    await trx
      .updateTable("customerAsset")
      .set({ status: "In Service", updatedBy: userId, updatedAt: now })
      .where("id", "in", assetIds)
      .where("companyId", "=", companyId)
      .execute();
  }
}
