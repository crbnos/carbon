// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy invoices dated on or after the cutover (spec section 5a). A company
// with no cutover posts a sales invoice and a purchase invoice after the
// cutover date, and their journals are deleted, as the reset deleted them.
// The enable writes them again: line for line what the posting wrote, so the
// receivables, payables and GR/IR carry the invoices, and a payment against
// the sales invoice finds its control line.

import type { Database } from "@carbon/database";
import {
  getCutoverInventory,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import issue from "../../issue";
import { databaseTest } from "../../local-database-test-fixture";
import postCharge from "../../post-charge";
import postInventoryAdjustment from "../../post-inventory-adjustment";
import postMemo from "../../post-memo";
import postPayment from "../../post-payment";
import postPurchaseInvoice from "../../post-purchase-invoice";
import postSalesInvoice from "../../post-sales-invoice";
import activateAccounting from "..";
import {
  activationFixture,
  deleteJournals,
  enableWithStockAtTen,
  type Fixture,
  glBalance,
  jobFixture,
  journaledFamilies,
  legacyDocumentCounts,
  legacyShipmentWithNoCostRow,
  moveBeforeCutover,
  openLayersValue,
  pay,
  postServiceInvoice,
  provisionalJournals,
  receiveFiveParts,
  shipFiveParts,
  USER,
  unwrap
} from "../activation-test-fixture";

type SourceType = Database["public"]["Enums"]["journalEntrySourceType"];

const INVOICE_SOURCES: SourceType[] = ["Sales Invoice", "Purchase Invoice"];
const DOCUMENT_SOURCES: SourceType[] = [
  "Sales Invoice",
  "Credit Memo",
  "Charge",
  "Payment"
];
const MOVEMENT_SOURCES: SourceType[] = [
  "Purchase Receipt",
  "Inventory Adjustment",
  "Sales Shipment"
];

databaseTest(
  "enabling accounting writes the journals of legacy invoices dated on or after the cutover",
  async () => {
    const f = await activationFixture();
    try {
      // Dimensions the postings write, so the rebuild must write them too.
      await f.db
        .insertInto("dimension")
        .values(
          (["Customer", "Supplier", "Item", "Location"] as const).map(
            (entityType) => ({
              name: entityType,
              entityType,
              companyGroupId: f.groupId,
              createdBy: USER
            })
          )
        )
        .execute();

      // After the cutover date: 5 parts received at 8 and invoiced at 9,
      // with a G/L line of 20; a sales invoice of 100.
      const purchaseOrderLineId = await receiveFiveParts(f, {
        id: "po-1",
        unitPrice: 8
      });
      await postPartAndGlInvoice(f, purchaseOrderLineId);
      const salesInvoiceId = await postServiceInvoice(f);

      // What the postings wrote, then gone, as the reset left them.
      const posted = await documentJournals(f, INVOICE_SOURCES);
      expect(posted.map((journal) => journal.sourceType).sort()).toEqual([
        "Purchase Invoice",
        "Sales Invoice"
      ]);
      // Every line carries its party dimension, at least.
      const postedLines = posted.flatMap((journal) => journal.pairs.flat());
      expect(postedLines.length).toBeGreaterThanOrEqual(7);
      for (const line of postedLines) {
        expect(
          line.dimensions.some(
            (dimension) =>
              dimension === `Customer=${f.customerId}` ||
              dimension === `Supplier=${f.supplierId}`
          )
        ).toBe(true);
      }
      await deleteJournals(f, INVOICE_SOURCES);
      expect(await documentJournals(f, INVOICE_SOURCES)).toEqual([]);

      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();

      // The wizard counts the documents before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals).toEqual({
        salesInvoices: 1,
        purchaseInvoices: 1,
        memos: 0,
        charges: 0,
        reimbursements: 0,
        payments: 0,
        purchaseReceipts: 0,
        salesReturnReceipts: 0,
        salesShipments: 0,
        returnShipments: 0,
        inventoryAdjustments: 0,
        inventoryCounts: 0,
        nonConformances: 0,
        maintenanceConsumptions: 0,
        jobConsumptions: 0,
        jobOutputs: 0,
        movementCostRows: 0,
        depreciationRuns: 0,
        assetDisposals: 0,
        revenueRecognitionRuns: 0
      });

      // The same journals, now Posted.
      const rebuilt = await documentJournals(f, INVOICE_SOURCES);
      expect(rebuilt.map(({ status, ...journal }) => journal)).toEqual(
        posted.map(({ status, ...journal }) => journal)
      );
      expect(rebuilt.map((journal) => journal.status)).toEqual([
        "Posted",
        "Posted"
      ]);
      const provisional = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("status", "=", "Provisional")
        .execute();
      expect(provisional).toEqual([]);

      expect(await glBalance(f, "receivables")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "sales")).toBeCloseTo(100, 6);
      // 45 for the parts and 20 for the G/L line.
      expect(await glBalance(f, "payables")).toBeCloseTo(65, 6);
      expect(await glBalance(f, "scrap")).toBeCloseTo(20, 6);
      // The receipt credited 40 and the invoice cleared it.
      expect(await glBalance(f, "grni")).toBeCloseTo(0, 6);
      // Received at 40, written up by the 5 the invoice added to the layer.
      expect(await glBalance(f, "inventory")).toBeCloseTo(45, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);

      // A payment after the enable finds the rebuilt control line.
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, {
            id: "pay-1",
            invoiceId: salesInvoiceId,
            amount: 100
          })
        })
      );
      expect(await glBalance(f, "receivables")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting writes the journals of a legacy memo, charge and payment dated on or after the cutover",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .insertInto("dimension")
        .values({
          name: "Customer",
          entityType: "Customer",
          companyGroupId: f.groupId,
          createdBy: USER
        })
        .execute();
      // The processor fee posts to an expense account.
      await f.db
        .updateTable("accountDefault")
        .set({ serviceChargeAccount: f.account("cogs") })
        .where("companyId", "=", f.companyId)
        .execute();

      // After the cutover date: a sales invoice of 100; a Stripe payment of
      // 60 with a fee of 2 that applies 50 and leaves 10 on account; a
      // credit memo of 30; a card charge of 100 to cost of goods.
      const salesInvoiceId = await postServiceInvoice(f);
      const paymentId = await pay(f, {
        id: "pay-1",
        invoiceId: salesInvoiceId,
        amount: 60,
        applied: 50
      });
      await f.db
        .updateTable("payment")
        .set({ reference: "STRIPE-1" })
        .where("id", "=", paymentId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .insertInto("externalIntegrationMapping")
        .values({
          integration: "stripe-connect",
          entityType: "payment",
          entityId: paymentId,
          externalId: "in_test",
          metadata: { feeAmount: 2, feeCurrency: "USD" },
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId,
          fee: {
            amount: 2,
            accountId: f.account("cogs"),
            description: "Stripe processing fee — STRIPE-1"
          }
        })
      );
      const memoId = await postCreditMemo(f, 30);
      const chargeId = await postCardCharge(f);

      const posted = await documentJournals(f, DOCUMENT_SOURCES);
      expect(posted.map((journal) => journal.sourceType).sort()).toEqual([
        "Charge",
        "Credit Memo",
        "Payment",
        "Sales Invoice"
      ]);
      await deleteJournals(f, DOCUMENT_SOURCES);
      expect(await documentJournals(f, DOCUMENT_SOURCES)).toEqual([]);

      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();
      // The wizard counts the documents before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals).toEqual({
        salesInvoices: 1,
        purchaseInvoices: 0,
        memos: 1,
        charges: 1,
        reimbursements: 0,
        payments: 1,
        purchaseReceipts: 0,
        salesReturnReceipts: 0,
        salesShipments: 0,
        returnShipments: 0,
        inventoryAdjustments: 0,
        inventoryCounts: 0,
        nonConformances: 0,
        maintenanceConsumptions: 0,
        jobConsumptions: 0,
        jobOutputs: 0,
        movementCostRows: 0,
        depreciationRuns: 0,
        assetDisposals: 0,
        revenueRecognitionRuns: 0
      });

      // The same journals, now Posted, with no Provisional left.
      const rebuilt = await documentJournals(f, DOCUMENT_SOURCES);
      expect(rebuilt.map(({ status, ...journal }) => journal)).toEqual(
        posted.map(({ status, ...journal }) => journal)
      );
      expect(new Set(rebuilt.map((journal) => journal.status))).toEqual(
        new Set(["Posted"])
      );
      const provisional = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("status", "=", "Provisional")
        .execute();
      expect(provisional).toEqual([]);

      // Each document points at its new journal.
      const [payment, memo, charge] = await Promise.all([
        f.db
          .selectFrom("payment")
          .select("journalId")
          .where("id", "=", paymentId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("memo")
          .select("journalId")
          .where("id", "=", memoId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("charge")
          .select("journalId")
          .where("id", "=", chargeId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ]);
      const sourceTypeById = new Map(
        (
          await f.db
            .selectFrom("journal")
            .select(["id", "sourceType"])
            .where("companyId", "=", f.companyId)
            .execute()
        ).map((journal) => [journal.id, journal.sourceType])
      );
      expect([
        sourceTypeById.get(payment.journalId ?? ""),
        sourceTypeById.get(memo.journalId ?? ""),
        sourceTypeById.get(charge.journalId ?? "")
      ]).toEqual(["Payment", "Credit Memo", "Charge"]);

      // 100 invoiced, 60 received (50 applied, 10 on account), 30 credited.
      expect(await glBalance(f, "receivables")).toBeCloseTo(10, 6);
      expect(await glBalance(f, "bank")).toBeCloseTo(58, 6);
      expect(await glBalance(f, "card")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "cogs")).toBeCloseTo(102, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting writes the journals of legacy movements that stored a cost row",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .insertInto("dimension")
        .values(
          (
            [
              "Customer",
              "Supplier",
              "Item",
              "Location",
              "ScrapReason",
              "Employee"
            ] as const
          ).map((entityType) => ({
            name: entityType,
            entityType,
            companyGroupId: f.groupId,
            createdBy: USER
          }))
        )
        .execute();
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      // After the cutover date: 5 parts received at 8 and 5 at 12; 1
      // scrapped (8); 2 found by an adjustment, at the average of the open
      // layers; 5 shipped (4 at 8 and 1 at 12). The shipment stores its
      // "Sale" cost row, as a company with accounting on did.
      const firstLine = await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      const secondLine = await receiveFiveParts(f, {
        id: "po-2",
        unitPrice: 12
      });
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Scrap",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 1,
          scrapReasonId: scrapReason.id,
          comment: "Dropped"
        })
      );
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Positive Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 2,
          comment: "Found"
        })
      );
      await shipFiveParts(f);

      const posted = await documentJournals(f, MOVEMENT_SOURCES);
      expect(posted.map((journal) => journal.sourceType).sort()).toEqual([
        "Inventory Adjustment",
        "Inventory Adjustment",
        "Purchase Receipt",
        "Purchase Receipt",
        "Sales Shipment"
      ]);
      await deleteJournals(f, MOVEMENT_SOURCES);
      expect(await documentJournals(f, MOVEMENT_SOURCES)).toEqual([]);

      // The wizard counts the documents before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals).toEqual({
        salesInvoices: 0,
        purchaseInvoices: 0,
        memos: 0,
        charges: 0,
        reimbursements: 0,
        payments: 0,
        purchaseReceipts: 2,
        salesReturnReceipts: 0,
        salesShipments: 1,
        returnShipments: 0,
        inventoryAdjustments: 2,
        inventoryCounts: 0,
        nonConformances: 0,
        maintenanceConsumptions: 0,
        jobConsumptions: 0,
        jobOutputs: 0,
        movementCostRows: 0,
        depreciationRuns: 0,
        assetDisposals: 0,
        revenueRecognitionRuns: 0
      });

      // The same journals, now Posted. The re-cost found nothing to move:
      // the layers relieved are the ones the postings relieved.
      const rebuilt = await documentJournals(f, MOVEMENT_SOURCES);
      expect(rebuilt.map(({ status, ...journal }) => journal)).toEqual(
        posted.map(({ status, ...journal }) => journal)
      );
      expect(new Set(rebuilt.map((journal) => journal.status))).toEqual(
        new Set(["Posted"])
      );
      const others = await f.db
        .selectFrom("journal")
        .select(["description", "status"])
        .where("companyId", "=", f.companyId)
        .where("sourceType", "not in", MOVEMENT_SOURCES)
        .execute();
      expect(others).toEqual([]);

      // Inventory on the GL equals the open layers: 4 at 12 and the 2 found.
      const layers = await f.db
        .selectFrom("costLedger")
        .select(
          sql<number>`coalesce(sum("cost" * "remainingQuantity" / "quantity"), 0)`.as(
            "value"
          )
        )
        .where("companyId", "=", f.companyId)
        .where("remainingQuantity", ">", 0)
        .where("adjustment", "=", false)
        .executeTakeFirstOrThrow();
      const inventory = await glBalance(f, "inventory");
      expect(inventory).toBeCloseTo(Number(layers.value), 4);
      expect(inventory).toBeCloseTo(40 + 60 - 8 - 44 + (2 * 92) / 9, 4);
      expect(await glBalance(f, "cogs")).toBeCloseTo(44, 6);
      expect(await glBalance(f, "scrap")).toBeCloseTo(8, 6);
      // The receipts' cost waits on GR/IR for the invoice.
      expect(await glBalance(f, "grni")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);

      // An invoice after the enable clears GR/IR at the receipt cost.
      await postPartsInvoice(f, [
        {
          purchaseOrderId: `${f.prefix}-po-1`,
          purchaseOrderLineId: firstLine,
          unitPrice: 8
        },
        {
          purchaseOrderId: `${f.prefix}-po-2`,
          purchaseOrderLineId: secondLine,
          unitPrice: 12
        }
      ]);
      expect(await glBalance(f, "grni")).toBeCloseTo(0, 6);
      expect(await glBalance(f, "payables")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(inventory, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the re-cost of the enable adjusts the rebuilt journal of a legacy shipment",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts at 8 and 5 at 12 received. After it: 5
      // shipped from the 8 layer (40), with the shipment's journal deleted.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      await shipFiveParts(f);
      await deleteJournals(f, ["Sales Shipment"]);
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const [part] = await getCutoverInventory(f.db, args);
      const unitCost = part!.unitCost;
      expect(unitCost).toBe(10);
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("inventory"), debit: 100, credit: 0 },
          { accountId: f.account("grni"), debit: 0, credit: 100 }
        ]
      });
      const result = unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );
      expect(result.legacyJournals.salesShipments).toBe(1);

      // The reset values the opening stock at 10 a part, so the re-cost
      // found the rebuilt inventory line and its COGS pair, and moved 10.
      const recost = await f.db
        .selectFrom("journal")
        .select(["sourceType", "status"])
        .where("companyId", "=", f.companyId)
        .where("description", "=", "Cutover recost")
        .execute();
      expect(recost).toEqual([
        { sourceType: "Sales Shipment", status: "Posted" }
      ]);
      expect(await glBalance(f, "cogs")).toBeCloseTo(5 * unitCost, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(5 * unitCost, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting costs a legacy shipment that stored no cost row against the reset layers",
  async () => {
    const f = await activationFixture();
    try {
      await legacyShipmentWithNoCostRow(f);
      // Today's unit cost is 12: the re-cost moves the shipment to the
      // opening layer's 10.
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 12 })
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .execute();
      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals).toMatchObject({
        salesShipments: 1,
        movementCostRows: 1
      });
      await expectShipmentCostedFromOpeningLayer(f);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the re-cost signs the pair of a legacy shipment costed at zero",
  async () => {
    const f = await activationFixture();
    try {
      await legacyShipmentWithNoCostRow(f);
      // Today's unit cost is nothing, so the shipment's pair posts at zero
      // and the re-cost takes its sign from the cost of goods account.
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 0 })
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .execute();
      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals).toMatchObject({
        salesShipments: 1,
        movementCostRows: 1
      });
      const recost = await f.db
        .selectFrom("journal")
        .select(["sourceType", "status"])
        .where("companyId", "=", f.companyId)
        .where("description", "=", "Cutover recost")
        .execute();
      expect(recost).toEqual([
        { sourceType: "Sales Shipment", status: "Posted" }
      ]);
      await expectShipmentCostedFromOpeningLayer(f);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting books the COGS of a legacy direct invoice line once, in the invoice journal",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts at 8 and 5 at 12. After it: 5 sold on
      // an invoice with no sales order, which relieved the 8 layer but kept
      // no "Sale" cost row and no journal, as main left it.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const invoiceId = await postDirectPartInvoice(f);
      await f.db
        .deleteFrom("costLedger")
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Sale")
        .execute();
      await deleteJournals(f, ["Sales Invoice"]);
      // Today's unit cost is 12: the re-cost moves the line to the opening
      // layer's 10.
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 12 })
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals).toMatchObject({
        salesInvoices: 1,
        salesShipments: 0,
        movementCostRows: 1
      });

      // One COGS pair, in the invoice journal, and the re-cost found it.
      const cogs = await f.db
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select([
          "journal.sourceType",
          "journal.description",
          "journalLine.amount"
        ])
        .where("journalLine.companyId", "=", f.companyId)
        .where("journalLine.accountId", "=", f.account("cogs"))
        .orderBy("journal.description")
        .execute();
      expect(
        cogs.map((line) => ({ ...line, amount: Number(line.amount) }))
      ).toEqual([
        {
          sourceType: "Sales Invoice",
          description: "Cutover recost",
          amount: -10
        },
        {
          sourceType: "Sales Invoice",
          description: "Sales Invoice INV-2",
          amount: 60
        }
      ]);
      expect(await glBalance(f, "receivables")).toBeCloseTo(125, 6);
      expect(await glBalance(f, "sales")).toBeCloseTo(125, 6);
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["documentId", "quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Sale")
        .executeTakeFirstOrThrow();
      expect(sale.documentId).toBe(invoiceId);
      expect([Number(sale.quantity), Number(sale.cost)]).toEqual([-5, -50]);
      expect(await glBalance(f, "cogs")).toBeCloseTo(50, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(50, 6);
      expect(await openLayersValue(f)).toBeCloseTo(50, 4);
      expect(await provisionalJournals(f)).toEqual([]);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting costs a legacy job issue and completion that stored no cost row",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts at 8 and 5 at 12. After it: 2 issued to
      // a job and the job completed with 1 assembly. Then the cost rows and
      // journals are gone, as a company with accounting off left them.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const job = await jobFixture(f);
      unwrap(
        await issue(f.ctx, {
          type: "partToOperation",
          id: job.operationId,
          itemId: f.partId,
          materialId: job.materialId,
          quantity: 2,
          adjustmentType: "Negative Adjmt."
        })
      );
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      await f.db
        .deleteFrom("costLedger")
        .where("companyId", "=", f.companyId)
        .where("documentType", "in", ["Job Consumption", "Job Receipt"])
        .execute();
      await f.db
        .updateTable("costLedger")
        .set({ remainingQuantity: sql`"quantity"` })
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Purchase")
        .execute();
      await deleteJournals(f, ["Job Consumption", "Job Receipt"]);
      // Today's unit cost of the part is 9, but the issue relieves the FIFO
      // layer open at 8, as calculateCOGS would have; the re-cost then moves
      // it to the opening layer's 10.
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 9 })
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals).toMatchObject({
        salesShipments: 0,
        jobConsumptions: 1,
        jobOutputs: 1,
        movementCostRows: 2
      });

      // The issue, re-costed against the opening layer; the output layer at
      // the material cost the issue had when the job completed (2 at 8).
      const rows = await f.db
        .selectFrom("costLedger")
        .select([
          "itemLedgerType",
          "documentType",
          "documentId",
          "itemId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .orderBy("entryNumber")
        .execute();
      expect(
        rows.map((row) => ({
          ...row,
          quantity: Number(row.quantity),
          cost: Number(row.cost),
          remainingQuantity: Number(row.remainingQuantity)
        }))
      ).toEqual([
        {
          itemLedgerType: "Consumption",
          documentType: "Job Consumption",
          documentId: job.jobId,
          itemId: f.partId,
          quantity: -2,
          cost: -20,
          remainingQuantity: 0
        },
        {
          itemLedgerType: "Output",
          documentType: "Job Receipt",
          documentId: job.jobId,
          itemId: job.assemblyId,
          quantity: 1,
          cost: 16,
          remainingQuantity: 1
        }
      ]);

      // The issue's pair names its operation, and the re-cost found it.
      const references = await f.db
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select([
          "journal.sourceType",
          "journal.description",
          "journalLine.documentLineReference"
        ])
        .distinct()
        .where("journalLine.companyId", "=", f.companyId)
        .where("journalLine.documentId", "=", job.jobId)
        .orderBy("journal.sourceType")
        .orderBy("journal.description")
        .execute();
      expect(references).toEqual([
        {
          sourceType: "Job Consumption",
          description: "Cutover recost",
          documentLineReference: `material-issue:${job.operationId}`
        },
        {
          sourceType: "Job Consumption",
          description: "Material Issue to Job J-1",
          documentLineReference: `material-issue:${job.operationId}`
        },
        {
          sourceType: "Job Receipt",
          description: "Job Completion J-1",
          documentLineReference: `job:${job.jobId}`
        }
      ]);

      // Stock on the GL equals the open layers: 8 parts at 10 and the
      // assembly at 16. The 4 the re-cost added after the completion stay
      // in WIP: the output layer is not valued again.
      expect(await glBalance(f, "inventory")).toBeCloseTo(80, 6);
      expect(await glBalance(f, "finished-goods")).toBeCloseTo(16, 6);
      expect(await glBalance(f, "wip")).toBeCloseTo(4, 6);
      expect(await openLayersValue(f)).toBeCloseTo(96, 4);
      expect(await provisionalJournals(f)).toEqual([]);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

/** A posted sales invoice with no sales order: 5 parts at 25. */
async function postDirectPartInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-direct-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "INV-2",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        postingDate: f.today,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Part",
        itemId: f.partId,
        methodType: "Pull from Inventory",
        quantity: 5,
        unitPrice: 25,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** The 5 shipped cost 50 from the opening layer, which keeps 5 at 10. */
async function expectShipmentCostedFromOpeningLayer(f: Fixture) {
  const sale = await f.db
    .selectFrom("costLedger")
    .select(["quantity", "cost"])
    .where("companyId", "=", f.companyId)
    .where("itemLedgerType", "=", "Sale")
    .executeTakeFirstOrThrow();
  expect([Number(sale.quantity), Number(sale.cost)]).toEqual([-5, -50]);
  expect(await glBalance(f, "cogs")).toBeCloseTo(50, 6);
  expect(await glBalance(f, "inventory")).toBeCloseTo(50, 6);
  expect(await openLayersValue(f)).toBeCloseTo(50, 4);
  expect(await provisionalJournals(f)).toEqual([]);
  expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
}

/** A posted credit memo of `amount` for the customer, dated today. */
async function postCreditMemo(f: Fixture, amount: number): Promise<string> {
  const memoId = `${f.prefix}-memo`;
  await f.db
    .insertInto("memo")
    .values({
      id: memoId,
      memoId: "CREDIT-1",
      companyId: f.companyId,
      customerId: f.customerId,
      direction: "Credit",
      memoDate: f.today,
      currencyCode: "USD",
      exchangeRate: 1,
      amount,
      createdBy: USER
    })
    .execute();
  unwrap(await postMemo(f.ctx, { type: "post", memoId }));
  return memoId;
}

/** A card charge of 100 from the card account to cost of goods, today. */
async function postCardCharge(f: Fixture): Promise<string> {
  const chargeId = `${f.prefix}-charge`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("charge")
      .values({
        id: chargeId,
        chargeId: "CHG-1",
        type: "Charge",
        status: "Draft",
        cardAccountId: f.account("card"),
        transactionDate: f.today,
        currencyCode: "USD",
        exchangeRate: 1,
        amount: 100,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("chargeLine")
      .values({
        chargeId,
        accountId: f.account("cogs"),
        description: "Card expense",
        amount: 100,
        sequence: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postCharge(f.ctx, { type: "post", chargeId }));
  return chargeId;
}

/** Invoices 5 parts on each PO line at its unit price. */
async function postPartsInvoice(
  f: Fixture,
  lines: {
    purchaseOrderId: string;
    purchaseOrderLineId: string;
    unitPrice: number;
  }[]
): Promise<string> {
  const invoiceId = `${f.prefix}-parts-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: "PI-2",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({ id: invoiceId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values(
        lines.map((line) => ({
          invoiceId,
          invoiceLineType: "Part" as const,
          itemId: f.partId,
          purchaseOrderId: line.purchaseOrderId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          quantity: 5,
          supplierUnitPrice: line.unitPrice,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          purchaseUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** Invoices 5 parts at 9 on the PO line and a G/L line of 20. */
async function postPartAndGlInvoice(
  f: Fixture,
  purchaseOrderLineId: string
): Promise<string> {
  const invoiceId = `${f.prefix}-purchase-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: "PI-1",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        supplierReference: "SUP-REF-1",
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({ id: invoiceId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values([
        {
          invoiceId,
          invoiceLineType: "Part",
          itemId: f.partId,
          purchaseOrderId: `${f.prefix}-po-1`,
          purchaseOrderLineId,
          quantity: 5,
          supplierUnitPrice: 9,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          purchaseUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        },
        {
          invoiceId,
          invoiceLineType: "G/L Account",
          accountId: f.account("scrap"),
          quantity: 1,
          supplierUnitPrice: 20,
          exchangeRate: 1,
          conversionFactor: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/**
 * The company's journals of the given source types: the header, and each
 * pair of lines (by journal line reference) with its dimensions, in an order
 * that does not depend on ids.
 */
async function documentJournals(f: Fixture, sourceTypes: SourceType[]) {
  const journals = await f.db
    .selectFrom("journal")
    .select(["id", "description", "postingDate", "sourceType", "status"])
    .where("companyId", "=", f.companyId)
    .where("sourceType", "in", sourceTypes)
    .orderBy("sourceType")
    .orderBy("description")
    .execute();
  if (journals.length === 0) return [];
  const lines = await f.db
    .selectFrom("journalLine")
    .select([
      "id",
      "journalId",
      "accountId",
      "accountDefaultRole",
      "description",
      "amount",
      "quantity",
      "accrual",
      "documentType",
      "documentId",
      "documentLineReference",
      "externalDocumentId",
      "intercompanyPartnerId",
      "journalLineReference"
    ])
    .where("companyId", "=", f.companyId)
    .where(
      "journalId",
      "in",
      journals.map((journal) => journal.id)
    )
    .execute();
  const dimensions = await f.db
    .selectFrom("journalLineDimension")
    .innerJoin("dimension", "dimension.id", "journalLineDimension.dimensionId")
    .select([
      "journalLineDimension.journalLineId",
      "dimension.entityType",
      "journalLineDimension.valueId"
    ])
    .where("journalLineDimension.companyId", "=", f.companyId)
    .where(
      "journalLineDimension.journalLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();
  const describe = (line: (typeof lines)[number]) => ({
    accountId: line.accountId,
    accountDefaultRole: line.accountDefaultRole,
    description: line.description,
    amount: Number(line.amount),
    quantity: Number(line.quantity),
    accrual: line.accrual,
    documentType: line.documentType,
    documentId: line.documentId,
    documentLineReference: line.documentLineReference,
    externalDocumentId: line.externalDocumentId,
    intercompanyPartnerId: line.intercompanyPartnerId,
    dimensions: dimensions
      .filter((dimension) => dimension.journalLineId === line.id)
      .map((dimension) => `${dimension.entityType}=${dimension.valueId}`)
      .sort()
  });
  const key = (value: unknown) => JSON.stringify(value);
  return journals.map((journal) => {
    const groups = new Map<string, ReturnType<typeof describe>[]>();
    for (const line of lines) {
      if (line.journalId !== journal.id) continue;
      const group = groups.get(line.journalLineReference) ?? [];
      group.push(describe(line));
      groups.set(line.journalLineReference, group);
    }
    return {
      description: journal.description,
      postingDate: String(journal.postingDate),
      sourceType: journal.sourceType,
      status: journal.status,
      pairs: [...groups.values()]
        .map((group) => group.sort((a, b) => key(a).localeCompare(key(b))))
        .sort((a, b) => key(a).localeCompare(key(b)))
    };
  });
}
