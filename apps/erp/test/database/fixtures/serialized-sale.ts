// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  assignShipmentSerial,
  issueMaterial,
  postShipment
} from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { type Fixture, USER, unwrap } from "./always-post";
import { handlesOf } from "./handles";
import { confirmPackoutCommand, createPairedJob } from "./paired-job";
import { createPackedShipment } from "./packout-shipment";

export async function stockSerials(f: Fixture, costs?: number[]) {
  await f.db
    .updateTable("item")
    .set({ itemTrackingType: "Serial" })
    .where("companyId", "=", f.companyId)
    .where("id", "=", f.assemblyId)
    .execute();
  const serials = (costs ?? [40, 22]).map((cost, index) => {
    const label = costs ? index : cost;
    return { cost, id: f.prefix + "-sn-" + label, readableId: "SN-" + label };
  });
  const common = { itemId: f.assemblyId, companyId: f.companyId, quantity: 1 };
  await f.db
    .insertInto("trackedEntity")
    .values(
      serials.map((unit) => ({
        ...common,
        id: unit.id,
        readableId: unit.readableId,
        sourceDocument: "Item",
        sourceDocumentId: f.assemblyId,
        status: "Available" as const,
        createdBy: USER
      }))
    )
    .execute();
  await f.db
    .insertInto("itemLedger")
    .values(
      serials.map((unit) => ({
        ...common,
        entryType: "Positive Adjmt." as const,
        locationId: f.locationId,
        trackedEntityId: unit.id,
        createdBy: USER
      }))
    )
    .execute();
  await f.db
    .insertInto("costLedger")
    .values(
      serials.map((unit) => ({
        ...common,
        cost: unit.cost,
        trackedEntityId: unit.id,
        remainingQuantity: 1,
        itemLedgerType: "Positive Adjmt." as const,
        costLedgerType: "Direct Cost" as const
      }))
    )
    .execute();
  return serials;
}

type Method = "FIFO" | "LIFO" | "Average" | "Standard";

export async function packSerials(
  f: Fixture,
  method: Method,
  sources: Awaited<ReturnType<typeof stockSerials>>,
  afterFirstReceipt?: (itemId: string, outputId: string) => Promise<void>
) {
  const job = await createPairedJob(f, f.assemblyId, sources.length);
  await f.db
    .updateTable("itemCost")
    .set({ costingMethod: method, standardCost: 15 })
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", job.salesItemId)
    .execute();
  const post = async (input: Parameters<typeof issueMaterial>[1]) =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "issue",
        await confirmPackoutCommand(f, input),
        issueMaterial
      )
    );
  const outputs: string[] = [];
  for (const source of sources) {
    const output = await f.db
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", job.salesItemId)
      .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
      .where("readableId", "is", null)
      .executeTakeFirstOrThrow();
    outputs.push(output.id!);
    await post({
      type: "trackedEntitiesToOperation",
      jobOperationId: job.operationId,
      materialId: job.materialId,
      parentTrackedEntityId: output.id!,
      children: [{ trackedEntityId: source.id, quantity: 1 }]
    });
    await post({
      type: "jobOperationSerialComplete",
      jobOperationId: job.operationId,
      trackedEntityId: output.id!,
      quantity: 1
    });
    if (outputs.length === 1) {
      await sql`SELECT receive_job_to_inventory(
        ${job.jobId}, 1, ${f.companyId}, ${USER}, ${f.locationId}, NULL, ARRAY[${source.readableId}]::text[]
      )`.execute(f.db);
      await afterFirstReceipt?.(job.salesItemId, output.id!);
    }
  }
  return { itemId: job.salesItemId, outputs };
}

async function createReturnLine(
  f: Fixture,
  itemId: string,
  shipmentLineId?: string
) {
  const returnType = shipmentLineId ? "Return to Stock" : "Return for Warranty";
  const reference = shipmentLineId ?? "warranty";
  const rma = await f.db
    .insertInto("salesReturnOrder")
    .values({
      salesReturnOrderId: "RMA-" + reference,
      status: "To Receive",
      customerId: f.customerId,
      currencyCode: "USD",
      orderDate: f.today,
      locationId: f.locationId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const line = await f.db
    .insertInto("salesReturnOrderLine")
    .values({
      salesReturnOrderId: rma.id,
      itemId,
      returnType,
      shipmentLineId,
      quantity: 1,
      unitOfMeasureCode: "EA",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { rmaId: rma.id, returnLineId: line.id };
}

export async function createNormalAndWarrantyShipment(f: Fixture, itemId: string) {
  const original = await createPackedShipment(f, itemId, "mixed");
  const warranty = await createReturnLine(f, itemId);
  await f.db
    .updateTable("accountDefault")
    .set({ warrantyExpenseAccount: f.account("scrap") })
    .where("companyId", "=", f.companyId)
    .execute();
  const soLine = await f.db
    .insertInto("salesOrderLine")
    .values({
      salesOrderId: original.salesOrderId,
      salesOrderLineType: "Part",
      itemId,
      saleQuantity: 1,
      salesReturnOrderLineId: warranty.returnLineId,
      unitPrice: 0,
      methodType: "Pull from Inventory",
      unitOfMeasureCode: "EA",
      locationId: f.locationId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const warrantyLine = await f.db
    .insertInto("shipmentLine")
    .values({
      shipmentId: original.shipmentId,
      lineId: soLine.id,
      itemId,
      unitOfMeasure: "EA",
      unitPrice: 0,
      orderQuantity: 1,
      shippedQuantity: 1,
      requiresSerialTracking: true,
      locationId: f.locationId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { ...original, warrantyLineId: warrantyLine.id };
}

/** Sell two units on separate lines of the same shipment, one under warranty. */
export async function shipNormalAndWarranty(
  f: Fixture,
  itemId: string,
  cheapId: string,
  richId: string
) {
  const original = await createNormalAndWarrantyShipment(f, itemId);
  for (const [shipmentLineId, trackedEntityId] of [
    [original.shipmentLineId, cheapId],
    [original.warrantyLineId, richId]
  ] as const) {
    expect(
      await assignShipmentSerial(
        f.db,
        f.companyId,
        {
          shipmentId: original.shipmentId,
          shipmentLineId,
          trackedEntityId,
          index: 0
        },
        {
          itemId,
          status: "Available",
          receiptId: undefined,
          sourceDocument: "Sales Order",
          sourceDocumentId: original.salesOrderId,
          supplierId: null
        }
      )
    ).toBeNull();
  }
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "post-shipment",
      { type: "post", shipmentId: original.shipmentId },
      postShipment
    )
  );
  return original;
}

/** A draft receipt, ready for the clerk to select the returned serial. */
export async function createLinkedSerialReturn(
  f: Fixture,
  itemId: string,
  shipmentLineId: string
) {
  const rma = await createReturnLine(f, itemId, shipmentLineId);
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromSalesReturnOrder",
      salesReturnOrderId: rma.rmaId,
      locationId: f.locationId
    })
  );
  const line = await f.db
    .selectFrom("receiptLine")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("receiptId", "=", receipt.id)
    .where("lineId", "=", rma.returnLineId)
    .executeTakeFirstOrThrow();
  return { ...rma, receiptId: receipt.id, receiptLineId: line.id };
}
