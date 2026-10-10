// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project stock (Projects Phase 2a): returns, counts and customer shipments
// keep to the stripe of the stock they move.

import { sql } from "kysely";
import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { assertEntitiesInCommonStock } from "../lib/stock-stripes";
import { databaseTest } from "../local-database-test-fixture";
import postInventoryCount from "../post-inventory-count/index";
import postReceipt from "../post-receipt/index";
import postShipment from "./index";

databaseTest(
  "a purchase return of stock received into a project draws the project's stock, and its void restores it",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      // An older common layer at 8.00: a return without the stripe would
      // relieve it first.
      await f.addStripeStock({
        itemId: part.itemId,
        locationId,
        projectId: null,
        quantity: 5,
        unitCost: 8,
        postingDate: "2025-01-01"
      });
      const po = await f.addPurchaseOrder("ret", {
        locationId,
        lines: [
          { itemId: part.itemId, quantity: 10, unitPrice: 10, charged: true }
        ]
      });
      const receipt = await f.addReceipt("ret", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity: 10,
            unitPrice: 10
          }
        ]
      });
      const received = await postReceipt(f.ctx, {
        receiptId: receipt.receiptId
      });
      expect(received.error).toBeNull();

      const returnOrderId = `${f.prefix}-pro`;
      const returnLineId = `${f.prefix}-prol`;
      const shipmentId = `${f.prefix}-ship`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("purchaseReturnOrder")
          .values({
            id: returnOrderId,
            purchaseReturnOrderId: `${f.prefix}-PRO-1`,
            supplierId: po.supplierId,
            currencyCode: "USD",
            orderDate: "2026-01-01",
            status: "To Ship",
            locationId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("purchaseReturnOrderLine")
          .values({
            id: returnLineId,
            purchaseReturnOrderId: returnOrderId,
            purchaseOrderLineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity: 3,
            unitPrice: 10,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("shipment")
          .values({
            id: shipmentId,
            shipmentId: `${f.prefix}-SH-1`,
            sourceDocument: "Purchase Return Order",
            sourceDocumentId: returnOrderId,
            locationId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("shipmentLine")
          .values({
            shipmentId,
            lineId: returnLineId,
            itemId: part.itemId,
            orderQuantity: 3,
            shippedQuantity: 3,
            unitOfMeasure: "EA",
            unitPrice: 10,
            locationId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const shipped = await postShipment(f.ctx, {
        type: "post",
        shipmentId
      });
      expect(shipped.error).toBeNull();

      const rows = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Return Shipment")
        .execute();
      expect(rows.map((row) => [Number(row.quantity), row.projectId])).toEqual([
        [-3, f.projectId]
      ]);
      const relief = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Return Shipment")
        .execute();
      expect(relief.map((row) => [Number(row.cost), row.projectId])).toEqual([
        [-30, f.projectId]
      ]);

      const voided = await postShipment(f.ctx, { type: "void", shipmentId });
      expect(voided.error).toBeNull();
      const stock = await f.db
        .selectFrom("itemStockQuantities")
        .select(["projectId", "quantityOnHand"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .orderBy("projectId")
        .execute();
      expect(
        stock.map((row) => [row.projectId, Number(row.quantityOnHand)])
      ).toEqual([
        ["", 5],
        [f.projectId, 10]
      ]);
      const restored = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Return Shipment")
        .where("quantity", ">", 0)
        .execute();
      expect(
        restored.map((row) => [Number(row.quantity), row.projectId])
      ).toEqual([[3, f.projectId]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a count posts each line's variance to the stripe it counted",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { itemId, locationId } = await f.addStockedItem("count", {
        quantity: 10,
        unitCost: 10
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12
      });
      const countId = `${f.prefix}-count`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("inventoryCount")
          .values({
            id: countId,
            inventoryCountId: `${f.prefix}-IC-1`,
            locationId,
            status: "Pending",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("inventoryCountLine")
          .values([
            {
              inventoryCountId: countId,
              itemId,
              locationId,
              projectId: null,
              systemQuantity: 10,
              countedQuantity: 10,
              companyId: f.companyId,
              createdBy: "system"
            },
            {
              inventoryCountId: countId,
              itemId,
              locationId,
              projectId: f.projectId,
              systemQuantity: 4,
              countedQuantity: 3,
              companyId: f.companyId,
              createdBy: "system"
            }
          ])
          .execute();
      });

      const posted = await postInventoryCount(f.ctx, {
        inventoryCountId: countId
      });
      expect(posted.error).toBeNull();

      const rows = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Inventory Count")
        .execute();
      expect(rows.map((row) => [Number(row.quantity), row.projectId])).toEqual([
        [-1, f.projectId]
      ]);
      const relief = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Inventory Count")
        .where("quantity", "<", 0)
        .execute();
      expect(relief.map((row) => [Number(row.cost), row.projectId])).toEqual([
        [-12, f.projectId]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a lot in project stock is refused for a document that ships to a customer",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { itemId, locationId } = await f.addStockedItem("lot", {
        quantity: 1,
        unitCost: 1
      });
      const lotId = `${f.prefix}-ship-lot`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("trackedEntity")
          .values({
            id: lotId,
            readableId: "LOT-SHIP",
            itemId,
            quantity: 2,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });
      const { itemLedgerId } = await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 2,
        unitCost: 5
      });
      await f.db
        .updateTable("itemLedger")
        .set({ trackedEntityId: lotId })
        .where("id", "=", itemLedgerId)
        .execute();

      await expect(
        assertEntitiesInCommonStock(f.db, f.companyId, [
          { id: lotId, readableId: "LOT-SHIP" }
        ])
      ).rejects.toThrow(/LOT-SHIP is in the stock of project/);
    } finally {
      await f.cleanup();
    }
  }
);
