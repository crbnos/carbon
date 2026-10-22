// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postReceipt as postReceiptBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const postReceipt = (ctx: Ctx, input: Parameters<typeof postReceiptBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-receipt", input, postReceiptBody);

databaseTest(
  "a receipt charges project lines to the project account and consumes stocked items at receipt",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const service = await f.addItem("service", {
        itemTrackingType: "Non-Inventory"
      });
      const charged = await f.addItem("charged", {
        itemTrackingType: "Inventory"
      });
      const stocked = await f.addItem("stocked", {
        itemTrackingType: "Inventory"
      });
      const po = await f.addPurchaseOrder("a", {
        locationId,
        lines: [
          { itemId: service.itemId, quantity: 2, unitPrice: 50, charged: true },
          { itemId: charged.itemId, quantity: 4, unitPrice: 10, charged: true },
          { itemId: stocked.itemId, quantity: 1, unitPrice: 5 }
        ]
      });
      const receipt = await f.addReceipt("a", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: service.itemId,
            quantity: 2,
            unitPrice: 50
          },
          {
            lineId: po.lineIds[1]!,
            itemId: charged.itemId,
            quantity: 4,
            unitPrice: 10
          },
          {
            lineId: po.lineIds[2]!,
            itemId: stocked.itemId,
            quantity: 1,
            unitPrice: 5
          }
        ]
      });

      const posted = await postReceipt(f.ctx, { receiptId: receipt.receiptId });
      expect(posted.error).toBeNull();

      const debits = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount", "documentLineReference"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Receipt")
        .where("documentId", "=", receipt.receiptId)
        .where("accountId", "!=", f.account("grni"))
        .orderBy("amount", "desc")
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 100],
        [f.account("project-expense"), 40],
        [f.account("inventory"), 5]
      ]);

      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "valueId"])
        .where("companyId", "=", f.companyId)
        .where("dimensionId", "in", [
          f.dimension("Project"),
          f.dimension("ProjectElement")
        ])
        .execute();
      expect(tags).toHaveLength(4);
      expect(new Set(tags.map((tag) => tag.journalLineId))).toEqual(
        new Set([debits[0]!.id, debits[1]!.id])
      );

      // The charged stocked item is received and issued at once.
      const chargedLedger = await f.db
        .selectFrom("itemLedger")
        .select(["entryType", "documentType", "documentId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", charged.itemId)
        .orderBy("quantity", "desc")
        .execute();
      expect(
        chargedLedger.map((row) => [
          row.entryType,
          row.documentType,
          row.documentId,
          Number(row.quantity)
        ])
      ).toEqual([
        ["Positive Adjmt.", "Purchase Receipt", receipt.receiptId, 4],
        ["Negative Adjmt.", "Project Issue", receipt.receiptId, -4]
      ]);
      const chargedStock = await f.db
        .selectFrom("itemStockQuantities")
        .select("quantityOnHand")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", charged.itemId)
        .execute();
      expect(
        chargedStock.reduce((sum, row) => sum + Number(row.quantityOnHand), 0)
      ).toEqual(0);

      // Only the uncharged stocked item gets a cost layer.
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["itemId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Receipt")
        .execute();
      expect(layers.map((layer) => layer.itemId)).toEqual([stocked.itemId]);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select([
          "costType",
          "documentType",
          "documentId",
          "documentLineId",
          "supplierId",
          "quantity",
          "amount",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          row.documentId,
          row.documentLineId,
          row.supplierId,
          Number(row.quantity),
          Number(row.amount),
          row.journalLineId
        ])
      ).toEqual([
        [
          "Purchased Service",
          "Purchase Receipt",
          receipt.receiptId,
          receipt.receiptLineIds[0],
          po.supplierId,
          2,
          100,
          debits[0]!.id
        ],
        [
          "Material",
          "Purchase Receipt",
          receipt.receiptId,
          receipt.receiptLineIds[1],
          po.supplierId,
          4,
          40,
          debits[1]!.id
        ]
      ]);

      // Voiding the receipt reverses the charges and the issue.
      const voided = await postReceipt(f.ctx, {
        type: "void",
        receiptId: receipt.receiptId
      });
      expect(voided.error).toBeNull();

      const net = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(Number(net?.amount ?? 0)).toEqual(0);
      const chargedNet = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", charged.itemId)
        .executeTakeFirst();
      expect(Number(chargedNet?.quantity ?? 0)).toEqual(0);
      const projectAccountNet = await f.db
        .selectFrom("journalLine")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("project-expense"))
        .executeTakeFirst();
      expect(Number(projectAccountNet?.amount ?? 0)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Statistical project keeps the receipt's own accounts and stock",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Statistical" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const po = await f.addPurchaseOrder("b", {
        locationId,
        lines: [
          { itemId: part.itemId, quantity: 3, unitPrice: 10, charged: true }
        ]
      });
      const receipt = await f.addReceipt("b", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity: 3,
            unitPrice: 10
          }
        ]
      });

      const posted = await postReceipt(f.ctx, { receiptId: receipt.receiptId });
      expect(posted.error).toBeNull();

      const debits = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", receipt.receiptId)
        .where("accountId", "!=", f.account("grni"))
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([[f.account("inventory"), 30]]);
      const stock = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .executeTakeFirst();
      expect(Number(stock?.quantity ?? 0)).toEqual(3);
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

// Project stock (Projects Phase 2a): a stocked item charged to a project with
// project stock enters that project's stock. The receipt debits inventory,
// opens a striped cost layer and charges nothing to the project. Its void
// takes the units back out of the project's stock.
databaseTest(
  "a receipt into project stock stripes the stock and its layer, and the void reverses it",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const po = await f.addPurchaseOrder("stock", {
        locationId,
        lines: [
          { itemId: part.itemId, quantity: 10, unitPrice: 10, charged: true }
        ]
      });
      const receipt = await f.addReceipt("stock", {
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

      const posted = await postReceipt(f.ctx, { receiptId: receipt.receiptId });
      expect(posted.error).toBeNull();

      // 1. One receipt row of +10 in the project's stripe, no Project Issue.
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["documentType", "quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .execute();
      expect(
        ledger.map((row) => [
          row.documentType,
          Number(row.quantity),
          row.projectId
        ])
      ).toEqual([["Purchase Receipt", 10, f.projectId]]);

      // 2. The cost layer is the project's.
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost", "remainingQuantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .execute();
      expect(
        layers.map((layer) => [
          Number(layer.quantity),
          Number(layer.cost),
          Number(layer.remainingQuantity),
          layer.projectId
        ])
      ).toEqual([[10, 100, 10, f.projectId]]);

      // 3. On-hand +10 under the project.
      const stock = async () =>
        (
          await f.db
            .selectFrom("itemStockQuantities")
            .select(["projectId", "quantityOnHand"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", part.itemId)
            .execute()
        ).map((row) => [row.projectId, Number(row.quantityOnHand)]);
      expect(await stock()).toEqual([[f.projectId, 10]]);

      // Inventory is debited, as for a common receipt, and nothing is charged
      // to the project.
      const debits = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Receipt")
        .where("documentId", "=", receipt.receiptId)
        .where("accountId", "!=", f.account("grni"))
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([[f.account("inventory"), 100]]);
      const charges = await f.db
        .selectFrom("projectLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(charges).toHaveLength(0);

      const voided = await postReceipt(f.ctx, {
        type: "void",
        receiptId: receipt.receiptId
      });
      expect(voided.error).toBeNull();
      const reversal = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("quantity", "<", 0)
        .executeTakeFirstOrThrow();
      expect(Number(reversal.quantity)).toEqual(-10);
      expect(reversal.projectId).toEqual(f.projectId);
      expect(await stock()).toEqual([[f.projectId, 0]]);
    } finally {
      await f.cleanup();
    }
  }
);
