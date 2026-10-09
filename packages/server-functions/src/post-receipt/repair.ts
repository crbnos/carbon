// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Depot repair through the RMA: what the receipt of a `Repair` line writes
// instead of stock. The unit stays the customer's: no stock ledger, no cost
// layer, no journal, and its serial stays Consumed. Each received serial gets
// its customer asset (At Depot) and one Depot Repair service order.
// Spec: .ai/specs/2026-10-08-field-service.md (Depot Repair through the RMA).

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder } from "@carbon/database/rows";
import { datetime } from "@carbon/utils";
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
