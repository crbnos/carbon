// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Depot repair through the RMA, receipt side: a Repair line posts no stock,
// no cost layer and no journal, keeps its serial Consumed, sets the asset At
// Depot and creates one Depot Repair order. A Return to Customer line on the
// same receipt posts as it always has.

import { journalReference } from "@carbon/database";
import { expect } from "vitest";
import { postReceipt as postReceiptBody } from "../../../app/modules/inventory/inventory.service";
import { insertServiceOrder } from "../../../app/modules/service/service-orders";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";
import { onHand, salesReturnRepairFixture } from "../fixtures/sales-return";

type Ctx = Parameters<typeof handlesOf>[0];

const postReceipt = (ctx: Ctx, input: Parameters<typeof postReceiptBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-receipt", input, postReceiptBody);

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type Rma = Awaited<ReturnType<typeof salesReturnRepairFixture>>;

async function receiptRows(f: Fixture, r: Rma) {
  const [itemLedger, costLedger, journalLines] = [
    await f.db
      .selectFrom("itemLedger")
      .select(["itemId", "quantity", "documentType"])
      .where("documentId", "=", r.receiptId)
      .where("companyId", "=", f.companyId)
      .execute(),
    await f.db
      .selectFrom("costLedger")
      .select(["itemId", "quantity", "cost"])
      .where("documentId", "=", r.receiptId)
      .where("companyId", "=", f.companyId)
      .execute(),
    await f.db
      .selectFrom("journalLine")
      .select(["documentLineReference", "amount"])
      .where("documentId", "=", r.receiptId)
      .where("companyId", "=", f.companyId)
      .execute()
  ];
  return { itemLedger, costLedger, journalLines };
}

async function depotOrders(f: Fixture, r: Rma) {
  return f.db
    .selectFrom("serviceOrder as so")
    .innerJoin("project as p", (join) =>
      join
        .onRef("p.id", "=", "so.projectId")
        .on("p.companyId", "=", f.companyId)
    )
    .select([
      "so.id",
      "so.type",
      "so.status",
      "so.trackedEntityId",
      "so.customerAssetId",
      "so.customerId",
      "so.customerLocationId",
      "so.locationId",
      "so.projectId",
      "p.projectType",
      "p.status as projectStatus"
    ])
    .where("so.salesReturnOrderLineId", "=", r.repairLineId)
    .where("so.companyId", "=", f.companyId)
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
    .select("status")
    .where("id", "=", r.assetId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { serial: serial.status, asset: asset.status };
}

databaseTest(
  "a Repair receipt posts no stock, cost layer or journal, sets the asset At Depot and creates a Depot Repair order; the Return to Customer line posts as before",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      const machineBefore = await onHand(f, r.machineItemId, r.locationId);
      const widgetBefore = await onHand(f, r.widgetItemId, r.locationId);

      const posted = await postReceipt(f.ctx, {
        type: "post",
        receiptId: r.receiptId
      });
      expect(posted.error).toBeNull();

      const rows = await receiptRows(f, r);
      // Only the widget line wrote stock, a cost layer and a journal.
      expect(rows.itemLedger).toEqual([
        {
          itemId: r.widgetItemId,
          quantity: 2,
          documentType: "Sales Return Receipt"
        }
      ]);
      expect(rows.costLedger).toEqual([
        { itemId: r.widgetItemId, quantity: 2, cost: 20 }
      ]);
      expect(rows.journalLines).toHaveLength(2);
      for (const line of rows.journalLines) {
        expect(line.documentLineReference).toBe(
          journalReference.to.receipt(r.returnLineId)
        );
      }
      expect(
        rows.journalLines.map((line) => Math.abs(Number(line.amount)))
      ).toEqual([20, 20]);

      expect(await onHand(f, r.machineItemId, r.locationId)).toBe(
        machineBefore
      );
      expect(await onHand(f, r.widgetItemId, r.locationId)).toBe(
        widgetBefore + 2
      );

      expect(await serialAndAsset(f, r)).toEqual({
        serial: "Consumed",
        asset: "At Depot"
      });

      const orders = await depotOrders(f, r);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({
        type: "Depot Repair",
        status: "Draft",
        trackedEntityId: r.serialId,
        customerAssetId: r.assetId,
        customerId: r.customerId,
        customerLocationId: r.siteId,
        locationId: r.locationId,
        projectType: "Service",
        projectStatus: "Draft"
      });

      const lines = await f.db
        .selectFrom("salesReturnOrderLine")
        .select(["id", "quantityReceived"])
        .where("salesReturnOrderId", "=", r.rmaId)
        .where("companyId", "=", f.companyId)
        .orderBy("lineNumber")
        .execute();
      expect(lines.map((line) => Number(line.quantityReceived))).toEqual([
        1, 2
      ]);

      const activity = await f.db
        .selectFrom("trackedActivity as ta")
        .innerJoin(
          "trackedActivityOutput as tao",
          "tao.trackedActivityId",
          "ta.id"
        )
        .select(["ta.type", "ta.attributes"])
        .where("tao.trackedEntityId", "=", r.serialId)
        .where("ta.companyId", "=", f.companyId)
        .execute();
      expect(activity).toHaveLength(1);
      expect(activity[0]?.type).toBe("Return Receipt");
      expect(activity[0]?.attributes).toMatchObject({
        "At Depot": true,
        "Service Order": orders[0]!.id
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Repair line with no serial on the receipt is refused",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      await f.db
        .updateTable("trackedEntity")
        .set({ attributes: {} })
        .where("id", "=", r.serialId)
        .execute();
      const posted = await postReceipt(f.ctx, {
        type: "post",
        receiptId: r.receiptId
      });
      expect(posted.error?.message).toContain(
        "Assign the serial before posting a repair receipt"
      );
      expect(await depotOrders(f, r)).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial with no customer asset gets a Manual one at receipt",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      await f.db
        .deleteFrom("customerAsset")
        .where("id", "=", r.assetId)
        .where("companyId", "=", f.companyId)
        .execute();
      const posted = await postReceipt(f.ctx, {
        type: "post",
        receiptId: r.receiptId
      });
      expect(posted.error).toBeNull();
      const asset = await f.db
        .selectFrom("customerAsset")
        .select(["source", "status", "customerId"])
        .where("trackedEntityId", "=", r.serialId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset).toEqual({
        source: "Manual",
        status: "At Depot",
        customerId: r.customerId
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding a repair receipt cancels its order, closes its project, sets the asset In Service and keeps the serial Consumed",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      const widgetBefore = await onHand(f, r.widgetItemId, r.locationId);
      expect(
        (await postReceipt(f.ctx, { type: "post", receiptId: r.receiptId }))
          .error
      ).toBeNull();

      const voided = await postReceipt(f.ctx, {
        type: "void",
        receiptId: r.receiptId
      });
      expect(voided.error).toBeNull();

      const [order] = await depotOrders(f, r);
      expect(order).toMatchObject({
        status: "Cancelled",
        projectStatus: "Closed"
      });
      expect(await serialAndAsset(f, r)).toEqual({
        serial: "Consumed",
        asset: "In Service"
      });
      // The widget line's stock is reversed as before.
      expect(await onHand(f, r.widgetItemId, r.locationId)).toBe(widgetBefore);
      const line = await f.db
        .selectFrom("salesReturnOrderLine")
        .select("quantityReceived")
        .where("id", "=", r.repairLineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(line.quantityReceived)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding a repair receipt is refused while its order has a charge that is not reversed",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      expect(
        (await postReceipt(f.ctx, { type: "post", receiptId: r.receiptId }))
          .error
      ).toBeNull();
      const [order] = await depotOrders(f, r);
      const charge = await f.db
        .insertInto("projectLedger")
        .values({
          projectId: order!.projectId,
          postingDate: "2026-01-02",
          costType: "Other Direct",
          documentType: "Project Expense",
          documentId: `${f.prefix}-expense`,
          amount: 40,
          coverage: "Billable",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const refused = await postReceipt(f.ctx, {
        type: "void",
        receiptId: r.receiptId
      });
      expect(refused.error?.message).toContain(
        "has posted charges. Reverse them before you void this receipt."
      );
      const [still] = await depotOrders(f, r);
      expect(still?.status).toBe("Draft");

      // Once the charge is reversed, the void goes through.
      await f.db
        .insertInto("projectLedger")
        .values({
          projectId: order!.projectId,
          postingDate: "2026-01-03",
          costType: "Other Direct",
          documentType: "Project Expense",
          documentId: `${f.prefix}-expense-reversal`,
          amount: -40,
          coverage: "Billable",
          reversalOfId: charge.id,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      expect(
        (await postReceipt(f.ctx, { type: "void", receiptId: r.receiptId }))
          .error
      ).toBeNull();
      const [cancelled] = await depotOrders(f, r);
      expect(cancelled?.status).toBe("Cancelled");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a repair receipt is refused while the serial has an open service order, and writes nothing",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await salesReturnRepairFixture(f);
      const open = await f.db.transaction().execute((trx) =>
        insertServiceOrder(trx, {
          companyId: f.companyId,
          userId: "system",
          type: "Field Visit",
          trackedEntityId: r.serialId,
          serial: "SN-0001",
          itemId: r.machineItemId,
          customerAssetId: r.assetId,
          customerId: r.customerId,
          customerName: "Acme",
          customerLocationId: r.siteId,
          locationId: r.locationId,
          customerContractId: null,
          contractProjectId: null
        })
      );

      const posted = await postReceipt(f.ctx, {
        type: "post",
        receiptId: r.receiptId
      });
      expect(posted.error?.message).toContain(
        `has an open service order (${open.serviceOrderId})`
      );
      expect(await depotOrders(f, r)).toHaveLength(0);
      expect(await serialAndAsset(f, r)).toEqual({
        serial: "Consumed",
        asset: "In Service"
      });
      const rows = await receiptRows(f, r);
      expect(rows.itemLedger).toHaveLength(0);
      expect(rows.journalLines).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);
