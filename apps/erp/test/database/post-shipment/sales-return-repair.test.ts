// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Depot repair through the RMA, shipping the unit back: the return shipment
// gets a Repair line only once the unit's order is done, posts no stock, cost
// layer or journal for it, keeps the serial Consumed and puts the asset back
// In Service. A Return to Customer line on the same shipment posts as before.

import { datetime } from "@carbon/utils";
import { expect } from "vitest";
import {
  postReceipt as postReceiptBody,
  postShipment as postShipmentBody
} from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";
import { onHand, salesReturnRepairFixture } from "../fixtures/sales-return";

type Ctx = Parameters<typeof handlesOf>[0];

const postReceipt = (ctx: Ctx, input: Parameters<typeof postReceiptBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-receipt", input, postReceiptBody);

const postShipment = (
  ctx: Ctx,
  input: Parameters<typeof postShipmentBody>[1]
) => invokePosting(handlesOf(ctx), "post-shipment", input, postShipmentBody);

const create = (ctx: Ctx, input: Parameters<typeof invokeCreate>[1]) =>
  invokeCreate(handlesOf(ctx), input);

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type Rma = Awaited<ReturnType<typeof salesReturnRepairFixture>>;

/** Receives the RMA (the machine for repair, 2 widgets back to stock). */
async function receiveRma(f: Fixture, r: Rma) {
  const posted = await postReceipt(f.ctx, {
    type: "post",
    receiptId: r.receiptId
  });
  expect(posted.error).toBeNull();
  const order = await f.db
    .selectFrom("serviceOrder")
    .select(["id"])
    .where("salesReturnOrderLineId", "=", r.repairLineId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return order.id;
}

async function completeOrder(f: Fixture, orderId: string) {
  await f.db
    .updateTable("serviceOrder")
    .set({ status: "Completed" })
    .where("id", "=", orderId)
    .where("companyId", "=", f.companyId)
    .execute();
}

/** Drafts the return shipment through `create` and returns its lines. */
async function draftReturnShipment(f: Fixture, r: Rma) {
  const created = await create(f.ctx, {
    type: "shipmentFromSalesReturnOrder",
    salesReturnOrderId: r.rmaId
  });
  expect(created.error).toBeNull();
  const shipmentId = (created.data as { id: string }).id;
  const lines = await f.db
    .selectFrom("shipmentLine")
    .select(["id", "lineId", "itemId", "shippedQuantity"])
    .where("shipmentId", "=", shipmentId)
    .where("companyId", "=", f.companyId)
    .execute();
  return { shipmentId, lines };
}

/** Assigns SN-0001 to the shipment's Repair line, as the tracking route does. */
async function assignSerial(
  f: Fixture,
  r: Rma,
  shipmentId: string,
  shipmentLineId: string
) {
  await f.db
    .updateTable("trackedEntity")
    .set({
      attributes: {
        Receipt: r.receiptId,
        "Receipt Line": r.repairReceiptLineId,
        Shipment: shipmentId,
        "Shipment Line": shipmentLineId,
        "Shipment Line Index": 0
      }
    })
    .where("id", "=", r.serialId)
    .execute();
}

async function serialAndAsset(f: Fixture, r: Rma) {
  const serial = await f.db
    .selectFrom("trackedEntity")
    .select("status")
    .where("id", "=", r.serialId)
    .executeTakeFirstOrThrow();
  const asset = await f.db
    .selectFrom("customerAsset")
    .select(["status", "shippedDate", "shipmentId", "customerLocationId"])
    .where("id", "=", r.assetId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { serial: serial.status, ...asset };
}

databaseTest(
  "a Repair return shipment posts no stock, cost layer or journal, keeps the serial Consumed and puts the asset back In Service; the widget line posts as before",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      const machineBefore = await onHand(f, r.machineItemId, r.locationId);
      const orderId = await receiveRma(f, r);

      // Before the order is done, the shipment has only the widget line.
      const early = await draftReturnShipment(f, r);
      expect(early.lines.map((line) => line.lineId)).toEqual([r.returnLineId]);
      await f.db
        .deleteFrom("shipment")
        .where("id", "=", early.shipmentId)
        .where("companyId", "=", f.companyId)
        .execute();

      await completeOrder(f, orderId);
      const { shipmentId, lines } = await draftReturnShipment(f, r);
      const repairLine = lines.find((line) => line.lineId === r.repairLineId);
      const widgetLine = lines.find((line) => line.lineId === r.returnLineId);
      expect(repairLine?.shippedQuantity).toBe(1);
      expect(widgetLine?.shippedQuantity).toBe(2);
      await assignSerial(f, r, shipmentId, repairLine!.id);
      const widgetAfterReceipt = await onHand(f, r.widgetItemId, r.locationId);

      const posted = await postShipment(f.ctx, { type: "post", shipmentId });
      expect(posted.error).toBeNull();

      const itemLedger = await f.db
        .selectFrom("itemLedger")
        .select(["itemId", "quantity"])
        .where("documentId", "=", shipmentId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(itemLedger).toEqual([{ itemId: r.widgetItemId, quantity: -2 }]);
      const costLedger = await f.db
        .selectFrom("costLedger")
        .select(["itemId", "quantity"])
        .where("documentId", "=", shipmentId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(costLedger).toEqual([{ itemId: r.widgetItemId, quantity: -2 }]);
      const journalLines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("documentId", "=", shipmentId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(journalLines.map((line) => Math.abs(Number(line.amount)))).toEqual(
        [20, 20]
      );

      // The machine never entered or left stock.
      expect(await onHand(f, r.machineItemId, r.locationId)).toBe(
        machineBefore
      );
      expect(await onHand(f, r.widgetItemId, r.locationId)).toBe(
        widgetAfterReceipt - 2
      );

      expect(await serialAndAsset(f, r)).toEqual({
        serial: "Consumed",
        status: "In Service",
        shippedDate: datetime.today("America/New_York").toString(),
        shipmentId,
        customerLocationId: r.siteId
      });

      const activity = await f.db
        .selectFrom("trackedActivity as ta")
        .innerJoin(
          "trackedActivityInput as tai",
          "tai.trackedActivityId",
          "ta.id"
        )
        .select(["ta.type", "ta.attributes"])
        .where("tai.trackedEntityId", "=", r.serialId)
        .where("ta.sourceDocumentId", "=", shipmentId)
        .where("ta.companyId", "=", f.companyId)
        .execute();
      expect(activity).toHaveLength(1);
      expect(activity[0]?.type).toBe("Return Shipment");
      expect(activity[0]?.attributes).toMatchObject({ "At Depot": false });

      // The order stays Completed: it closes at its invoice or with Close.
      const order = await f.db
        .selectFrom("serviceOrder")
        .select("status")
        .where("id", "=", orderId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(order.status).toBe("Completed");

      // The void keeps the serial Consumed and the unit goes back At Depot.
      const voided = await postShipment(f.ctx, { type: "void", shipmentId });
      expect(voided.error).toBeNull();
      const afterVoid = await serialAndAsset(f, r);
      expect(afterVoid.serial).toBe("Consumed");
      expect(afterVoid.status).toBe("At Depot");
      expect(await onHand(f, r.machineItemId, r.locationId)).toBe(
        machineBefore
      );
      expect(await onHand(f, r.widgetItemId, r.locationId)).toBe(
        widgetAfterReceipt
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Repair return shipment is refused while the unit's order is not done",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      const orderId = await receiveRma(f, r);
      await completeOrder(f, orderId);
      const { shipmentId, lines } = await draftReturnShipment(f, r);
      const repairLine = lines.find((line) => line.lineId === r.repairLineId);
      await assignSerial(f, r, shipmentId, repairLine!.id);
      // Reopened after the shipment was drafted.
      await f.db
        .updateTable("serviceOrder")
        .set({ status: "In Progress" })
        .where("id", "=", orderId)
        .where("companyId", "=", f.companyId)
        .execute();

      const posted = await postShipment(f.ctx, { type: "post", shipmentId });
      expect(posted.error?.message).toContain(
        "Complete the unit's service order before you ship it back"
      );
      expect((await serialAndAsset(f, r)).status).toBe("At Depot");
    } finally {
      await f.cleanup();
    }
  }
);
