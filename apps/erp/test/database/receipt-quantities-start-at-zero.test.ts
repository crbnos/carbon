// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Blind receiving against the live database: with
// `companySettings.receiptQuantitiesStartAtZero` on, a purchase-order receipt's
// lines start at 0, and posting it books only the lines that were received.

import { expect } from "vitest";
import { postReceipt } from "../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** A purchase order with two lines of 10 of the fixture's part. */
async function purchaseOrderWithTwoLines(f: Fixture): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-blind`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-BLIND",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values(
        ["line-1", "line-2"].map((key) => ({
          id: `${f.prefix}-pol-${key}`,
          purchaseOrderId,
          purchaseOrderLineType: "Part" as const,
          itemId: f.partId,
          purchaseQuantity: 10,
          supplierUnitPrice: 10,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return purchaseOrderId;
}

async function setStartAtZero(f: Fixture, value: boolean) {
  await f.db
    .updateTable("companySettings")
    .set({ receiptQuantitiesStartAtZero: value })
    .where("id", "=", f.companyId)
    .execute();
}

async function receiptLines(f: Fixture, receiptId: string) {
  return f.db
    .selectFrom("receiptLine")
    .select(["id", "lineId", "receivedQuantity", "outstandingQuantity"])
    .where("receiptId", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .orderBy("lineId")
    .execute();
}

databaseTest(
  "a receipt starts each line at the quantity to receive when the setting is off",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrderWithTwoLines(f);
      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      const lines = await receiptLines(f, receipt.id);
      expect(lines.map((l) => Number(l.receivedQuantity))).toEqual([10, 10]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with the setting on, a receipt starts at 0 and posts only the lines that were received",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await setStartAtZero(f, true);
      const purchaseOrderId = await purchaseOrderWithTwoLines(f);
      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      const lines = await receiptLines(f, receipt.id);
      expect(
        lines.map((l) => [
          Number(l.receivedQuantity),
          Number(l.outstandingQuantity)
        ])
      ).toEqual([
        [0, 10],
        [0, 10]
      ]);

      // The receiver counts 4 on the first line; nothing arrived for the second.
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 4 })
        .where("id", "=", lines[0]!.id)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "post", receiptId: receipt.id },
          postReceipt
        )
      );

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("quantity")
        .where("documentId", "=", receipt.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger.map((row) => Number(row.quantity))).toEqual([4]);

      const purchaseOrderLines = await f.db
        .selectFrom("purchaseOrderLine")
        .select(["id", "quantityReceived", "receivedComplete"])
        .where("purchaseOrderId", "=", purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .orderBy("id")
        .execute();
      expect(
        purchaseOrderLines.map((l) => [
          Number(l.quantityReceived),
          l.receivedComplete
        ])
      ).toEqual([
        [4, false],
        [0, false]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with the setting on, transfer and sales return receipts start at 0",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await setStartAtZero(f, true);
      const warehouseTransferId = `${f.prefix}-transfer-blind`;
      const salesReturnOrderId = `${f.prefix}-rma-blind`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("warehouseTransfer")
          .values({
            id: warehouseTransferId,
            transferId: "WT-BLIND",
            fromLocationId: f.otherLocationId,
            toLocationId: f.locationId,
            status: "To Receive",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("warehouseTransferLine")
          .values({
            transferId: warehouseTransferId,
            itemId: f.partId,
            quantity: 5,
            shippedQuantity: 5,
            fromLocationId: f.otherLocationId,
            toLocationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesReturnOrder")
          .values({
            id: salesReturnOrderId,
            salesReturnOrderId: "RMA-BLIND",
            customerId: f.customerId,
            currencyCode: "USD",
            orderDate: f.today,
            locationId: f.locationId,
            status: "To Receive",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesReturnOrderLine")
          .values({
            salesReturnOrderId,
            itemId: f.partId,
            quantity: 2,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const transferReceipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromInboundTransfer",
          warehouseTransferId
        })
      );
      const returnReceipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromSalesReturnOrder",
          salesReturnOrderId,
          locationId: f.locationId
        })
      );

      for (const [receiptId, outstanding] of [
        [transferReceipt.id, 5],
        [returnReceipt.id, 2]
      ] as const) {
        const lines = await receiptLines(f, receiptId);
        expect(
          lines.map((l) => [
            Number(l.receivedQuantity),
            Number(l.outstandingQuantity)
          ])
        ).toEqual([[0, outstanding]]);
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with the setting on, a purchase order's fixed-asset line starts unticked",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await setStartAtZero(f, true);
      const purchaseOrderId = `${f.prefix}-po-asset`;
      await seed(f, async (trx) => {
        const filler = f.account("filler");
        const assetClass = await trx
          .insertInto("fixedAssetClass")
          .values({
            name: `${f.prefix} machinery`,
            assetAccountId: filler,
            accumulatedDepreciationAccountId: filler,
            depreciationExpenseAccountId: filler,
            writeOffAccountId: filler,
            writeDownAccountId: filler,
            lossOnDisposalAccountId: filler,
            gainOnDisposalAccountId: filler,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const asset = await trx
          .insertInto("fixedAsset")
          .values({
            fixedAssetId: `${f.prefix}-FA`,
            name: "CNC machining center",
            fixedAssetClassId: assetClass.id,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: f.supplierId, companyId: f.companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseOrder")
          .values({
            id: purchaseOrderId,
            purchaseOrderId: "PO-ASSET",
            supplierId: f.supplierId,
            supplierInteractionId: interaction.id,
            currencyCode: "USD",
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseOrderDelivery")
          .values({
            id: purchaseOrderId,
            locationId: f.locationId,
            companyId: f.companyId
          })
          .execute();
        await trx
          .insertInto("purchaseOrderLine")
          .values({
            purchaseOrderId,
            purchaseOrderLineType: "Fixed Asset",
            assetId: asset.id,
            purchaseQuantity: 1,
            supplierUnitPrice: 1000,
            exchangeRate: 1,
            conversionFactor: 1,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      const assetLines = await f.db
        .selectFrom("receiptFixedAssetLine")
        .select("received")
        .where("receiptId", "=", receipt.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(assetLines.map((l) => l.received)).toEqual([false]);
    } finally {
      await f.cleanup();
    }
  }
);
