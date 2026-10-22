// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postReceipt as postReceiptBody } from "../../../app/modules/inventory/inventory.service";
import { postPurchaseInvoice as postPurchaseInvoiceBody } from "../../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const postReceipt = (ctx: Ctx, input: Parameters<typeof postReceiptBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-receipt", input, postReceiptBody);

const postPurchaseInvoice = (
  ctx: Ctx,
  input: Parameters<typeof postPurchaseInvoiceBody>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "post-purchase-invoice",
    input,
    postPurchaseInvoiceBody
  );

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

      // The reversal row names the void journal's line that negates the
      // project line, so the revenue run can relieve it.
      const reversal = await f.db
        .selectFrom("projectLedger")
        .innerJoin("journalLine", (join) =>
          join
            .onRef("journalLine.id", "=", "projectLedger.journalLineId")
            .onRef("journalLine.companyId", "=", "projectLedger.companyId")
        )
        .select(["journalLine.accountId", "journalLine.amount"])
        .where("projectLedger.companyId", "=", f.companyId)
        .where("projectLedger.reversalOfId", "is not", null)
        .executeTakeFirstOrThrow();
      expect([reversal.accountId, Number(reversal.amount)]).toEqual([
        f.account("project-expense"),
        -200
      ]);
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

// Projects Phase 3: the invoice of a grouped PO line. The receipt split the
// line into member stripes, so the price variance spreads over the striped
// layers: the on-hand stripes are revalued, and the consumed share of a
// member's layer is that member's Material Variance.
databaseTest(
  "the price variance of a grouped line revalues on-hand stripes and charges a member's consumed share",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const group = await f.addPlanningGroup({
        locationId,
        members: [
          { key: "101", identifier: "PA" },
          { key: "102", identifier: "PB" },
          { key: "103", identifier: "PC" }
        ]
      });
      const member = (key: string) => group.projectIds[key]!;
      const po = await f.addPurchaseOrder("grouped", {
        locationId,
        lines: [
          {
            itemId: part.itemId,
            quantity: 60,
            unitPrice: 10,
            planningGroupId: group.planningGroupId
          }
        ]
      });
      for (const [key, quantity, needDate] of [
        ["101", 20, "2026-11-01"],
        ["102", 30, "2026-11-02"],
        ["103", 10, "2026-11-03"]
      ] as const) {
        await f.addPeg({
          planningGroupId: group.planningGroupId,
          itemId: part.itemId,
          locationId,
          supplyType: "Purchase Order Line",
          supplyId: po.lineIds[0]!,
          projectId: member(key),
          quantity,
          needDate
        });
      }
      const receipt = await f.addReceipt("grouped", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity: 60,
            unitPrice: 10
          }
        ]
      });
      const received = await postReceipt(f.ctx, {
        receiptId: receipt.receiptId
      });
      expect(received.error).toBeNull();

      // P-101's 20 units are already issued: its layer has nothing left.
      await f.db
        .updateTable("costLedger")
        .set({ remainingQuantity: 0 })
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("projectId", "=", member("101"))
        .execute();

      const invoice = await f.addPurchaseInvoice("grouped", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "Part",
            itemId: part.itemId,
            locationId,
            quantity: 60,
            unitPrice: 11,
            purchaseOrderId: po.purchaseOrderId,
            purchaseOrderLineId: po.lineIds[0]
          }
        ]
      });
      const posted = await postPurchaseInvoice(f.ctx, {
        invoiceId: invoice.invoiceId
      });
      expect(posted.error).toBeNull();

      // 20.00 to P-101's project account, 40.00 to inventory, no PPV.
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
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
        [f.account("grni")]: -600,
        [f.account("inventory")]: 40,
        [f.account("project-expense")]: 20,
        [f.account("payables")]: 660
      });

      // P-102's and P-103's layers are revalued by 30.00 and 10.00.
      const adjustments = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("adjustment", "=", true)
        .orderBy("cost", "desc")
        .execute();
      expect(
        adjustments.map((row) => [Number(row.cost), row.projectId])
      ).toEqual([
        [30, member("102")],
        [10, member("103")]
      ]);

      // P-101's ledger gets the consumed share, tagged with its project.
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["projectId", "costType", "amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [row.projectId, row.costType, Number(row.amount)])
      ).toEqual([[member("101"), "Material Variance", 20]]);
      const projectLine = lines.find(
        (line) => line.accountId === f.account("project-expense")
      );
      expect(ledger[0]!.journalLineId).toEqual(projectLine!.id);
      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "valueId"])
        .where("companyId", "=", f.companyId)
        .where("dimensionId", "=", f.dimension("Project"))
        .execute();
      expect(tags).toEqual([
        { journalLineId: projectLine!.id, valueId: member("101") }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
