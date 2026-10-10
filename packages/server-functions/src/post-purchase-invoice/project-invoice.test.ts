// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postReceipt from "../post-receipt/index";
import postPurchaseInvoice from "./index";

databaseTest(
  "a G/L Account line charged to an Expense project debits the project account",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const po = await f.addPurchaseOrder("a", { locationId, lines: [] });
      const invoice = await f.addPurchaseInvoice("a", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("indirect"),
            quantity: 1,
            unitPrice: 200,
            charged: true
          },
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("indirect"),
            quantity: 1,
            unitPrice: 30
          }
        ]
      });

      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      const debits = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Invoice")
        .where("documentId", "=", invoice.invoiceId)
        .where("accountId", "!=", f.account("payables"))
        .orderBy("amount", "desc")
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 200],
        [f.account("indirect"), 30]
      ]);

      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("companyId", "=", f.companyId)
        .where("journalLineId", "=", debits[0]!.id)
        .where("dimensionId", "in", [
          f.dimension("Project"),
          f.dimension("ProjectElement")
        ])
        .execute();
      expect(tags.map((tag) => tag.valueId).sort()).toEqual(
        [f.elementId, f.projectId].sort()
      );

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select([
          "costType",
          "documentType",
          "documentId",
          "documentLineId",
          "amount",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          row.documentId,
          row.documentLineId,
          Number(row.amount),
          row.journalLineId
        ])
      ).toEqual([
        [
          "Other Direct",
          "Purchase Invoice",
          invoice.invoiceId,
          invoice.lineIds[0],
          200,
          debits[0]!.id
        ]
      ]);

      // Voiding the invoice reverses the charge.
      const voided = await postPurchaseInvoice(f.ctx, {
        type: "void",
        invoiceId: invoice.invoiceId
      });
      expect(voided.error).toBeNull();
      const net = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(Number(net?.amount ?? 0)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the invoice of a line its receipt charged to the project writes only the price variance",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const po = await f.addPurchaseOrder("b", {
        locationId,
        lines: [
          { itemId: part.itemId, quantity: 4, unitPrice: 10, charged: true }
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
            quantity: 4,
            unitPrice: 10
          }
        ]
      });
      const received = await postReceipt(f.ctx, {
        receiptId: receipt.receiptId
      });
      expect(received.error).toBeNull();

      const invoice = await f.addPurchaseInvoice("b", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "Part",
            itemId: part.itemId,
            locationId,
            quantity: 4,
            unitPrice: 12,
            purchaseOrderId: po.purchaseOrderId,
            purchaseOrderLineId: po.lineIds[0],
            charged: true
          }
        ]
      });
      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Invoice")
        .where("documentId", "=", invoice.invoiceId)
        .orderBy("accountId")
        .execute();
      expect(
        Object.fromEntries(
          lines.map((line) => [line.accountId, Number(line.amount)])
        )
      ).toEqual({
        [f.account("grni")]: -40,
        [f.account("project-expense")]: 8,
        [f.account("payables")]: 48
      });

      // No layer write-up: nothing of the receipt stayed in stock.
      const invoiceLayers = await f.db
        .selectFrom("costLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .execute();
      expect(invoiceLayers).toEqual([]);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "documentType", "amount"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          Number(row.amount)
        ])
      ).toEqual([
        ["Material", "Purchase Receipt", 40],
        ["Material Variance", "Purchase Invoice", 8]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a late cost on an Active capital asset debits its class account, and a void takes it off",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { fixedAssetId } = await f.addCapitalAsset({
        status: "Active",
        finalAssetElement: true,
        acquisitionCost: 1000
      });
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const po = await f.addPurchaseOrder("late", { locationId, lines: [] });
      const invoice = await f.addPurchaseInvoice("late", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("indirect"),
            quantity: 1,
            unitPrice: 200,
            charged: true
          }
        ]
      });

      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      const debits = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Invoice")
        .where("documentId", "=", invoice.invoiceId)
        .where("accountId", "!=", f.account("payables"))
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([[f.account("machinery"), 200]]);

      const cipRows = await f.db
        .selectFrom("fixedAssetCipCost")
        .select([
          "fixedAssetId",
          "sourceType",
          "amount",
          "postCapitalization",
          "projectElementId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(cipRows).toHaveLength(1);
      expect(cipRows[0]).toMatchObject({
        fixedAssetId,
        sourceType: "Purchase Invoice",
        postCapitalization: true,
        projectElementId: f.elementId
      });
      expect(Number(cipRows[0]!.amount)).toEqual(200);

      const assetCost = async () =>
        Number(
          (
            await f.db
              .selectFrom("fixedAsset")
              .select("acquisitionCost")
              .where("id", "=", fixedAssetId)
              .where("companyId", "=", f.companyId)
              .executeTakeFirstOrThrow()
          ).acquisitionCost
        );
      expect(await assetCost()).toEqual(1200);

      const voided = await postPurchaseInvoice(f.ctx, {
        type: "void",
        invoiceId: invoice.invoiceId
      });
      expect(voided.error).toBeNull();

      const remaining = await f.db
        .selectFrom("fixedAssetCipCost")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(remaining).toEqual([]);
      expect(await assetCost()).toEqual(1000);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a void is refused once the asset its cost built went into service",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { fixedAssetId, classId } = await f.addCapitalAsset({
        status: "Under Construction",
        finalAssetElement: true
      });
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const po = await f.addPurchaseOrder("built", { locationId, lines: [] });
      const invoice = await f.addPurchaseInvoice("built", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("indirect"),
            quantity: 1,
            unitPrice: 300,
            charged: true
          }
        ]
      });
      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      // The asset went into service since.
      await f.db
        .updateTable("fixedAsset")
        .set({ status: "Active", fixedAssetClassId: classId })
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", f.companyId)
        .execute();

      const voided = await postPurchaseInvoice(f.ctx, {
        type: "void",
        invoiceId: invoice.invoiceId
      });
      expect(voided.error?.message).toMatch(/was capitalized/);

      const rows = await f.db
        .selectFrom("fixedAssetCipCost")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(rows).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  }
);

// Project stock (Projects Phase 2a), with Charge at receipt: the receipt
// charges the project and puts the goods in its stock. The invoice adjusts the
// project's cost layer like any stocked receipt: the variance writes up
// inventory and becomes a child row in the project's stripe, and the project's
// ledger gets a Material Variance row.
databaseTest(
  "the invoice of a receipt into project stock adjusts the project's cost layer",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      await f.db
        .updateTable("project")
        .set({ chargeAtReceipt: true })
        .where("id", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const po = await f.addPurchaseOrder("stock", {
        locationId,
        lines: [
          { itemId: part.itemId, quantity: 4, unitPrice: 10, charged: true }
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
            quantity: 4,
            unitPrice: 10
          }
        ]
      });
      const received = await postReceipt(f.ctx, {
        receiptId: receipt.receiptId
      });
      expect(received.error).toBeNull();

      const invoice = await f.addPurchaseInvoice("stock", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "Part",
            itemId: part.itemId,
            locationId,
            quantity: 4,
            unitPrice: 12,
            purchaseOrderId: po.purchaseOrderId,
            purchaseOrderLineId: po.lineIds[0],
            charged: true
          }
        ]
      });
      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Invoice")
        .where("documentId", "=", invoice.invoiceId)
        .orderBy("accountId")
        .execute();
      expect(
        Object.fromEntries(
          lines.map((line) => [line.accountId, Number(line.amount)])
        )
      ).toEqual({
        [f.account("grni")]: -40,
        [f.account("inventory")]: 8,
        [f.account("payables")]: 48
      });

      const layers = await f.db
        .selectFrom("costLedger")
        .select(["adjustment", "cost", "projectId", "appliesToCostLedgerId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .orderBy("adjustment")
        .execute();
      expect(
        layers.map((layer) => [
          layer.adjustment,
          Number(layer.cost),
          layer.projectId
        ])
      ).toEqual([
        [false, 40, f.projectId],
        [true, 8, f.projectId]
      ]);

      // The receipt charged the project at receipt cost; the invoice adds
      // the price variance, on the inventory write-up line.
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "documentType", "amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          Number(row.amount)
        ])
      ).toEqual([
        ["Material", "Purchase Receipt", 40],
        ["Material Variance", "Purchase Invoice", 8]
      ]);
      const writeUp = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("id", "=", ledger[1]!.journalLineId!)
        .executeTakeFirstOrThrow();
      expect([writeUp.accountId, Number(writeUp.amount)]).toEqual([
        f.account("inventory"),
        8
      ]);

      // The void reverses the variance row with the invoice.
      const voided = await postPurchaseInvoice(f.ctx, {
        type: "void",
        invoiceId: invoice.invoiceId
      });
      expect(voided.error).toBeNull();
      const net = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Invoice")
        .executeTakeFirst();
      expect(Number(net?.amount ?? 0)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
