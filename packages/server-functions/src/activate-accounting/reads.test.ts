// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The cutover reads (@carbon/database/accounting-cutover-reads) against the
// live database: a company with no cutover posts real documents, and the
// reads report what is open at a cutover date after them.

import { journalReference } from "@carbon/database";
import {
  cutoverDateReason,
  getActivationReadiness,
  getCutoverInventory,
  getCutoverOpenItems,
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION } from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Insertable, sql } from "kysely";
import { describe, expect, it } from "vitest";
import create from "../create";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import postPayment from "../post-payment";
import postPurchaseInvoice from "../post-purchase-invoice";
import postReceipt from "../post-receipt";
import { FILLER_ACCOUNT_DEFAULTS } from "../post-reimbursement/post-reimbursement-test-fixture";
import postSalesInvoice from "../post-sales-invoice";
import postShipment from "../post-shipment";
import { ServerFnContext } from "../server-fn-context";
import {
  insertEmployee,
  payOutReimbursement,
  postReimbursementOf
} from "./activation-test-fixture";

const USER = "system";
const TIME_ZONE = "America/New_York";

const ACCOUNTS = [
  { name: "filler", class: "Asset" },
  { name: "inventory", class: "Asset" },
  { name: "finished-goods", class: "Asset" },
  { name: "wip", class: "Asset" },
  { name: "receivables", class: "Asset" },
  { name: "bank", class: "Asset" },
  { name: "grni", class: "Liability" },
  { name: "payables", class: "Liability" },
  { name: "employee-payable", class: "Liability" },
  { name: "retained-earnings", class: "Equity" },
  { name: "sales", class: "Revenue" },
  { name: "cogs", class: "Expense" }
] as const;

type AccountName = (typeof ACCOUNTS)[number]["name"];

/** A company with no accounting cutover, a bought stock part, a service
 *  item, a customer and a supplier. */
async function cutoverReadsFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `cutoverreads-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const locationId = `${prefix}-location`;
  const partId = `${prefix}-part`;
  const serviceId = `${prefix}-service`;
  const customerId = `${prefix}-customer`;
  const supplierId = `${prefix}-supplier`;
  const account = (name: AccountName) => `${prefix}-${name}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: TIME_ZONE
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .updateTable("companySettings")
      .set({ accountingCutoverDate: null })
      .where("id", "=", companyId)
      .execute();
    await trx
      .insertInto("sequence")
      .values([
        { table: "receipt", name: "Receipt", prefix: "RCV-", companyId },
        { table: "shipment", name: "Shipment", prefix: "SHP-", companyId },
        {
          table: "journalEntry",
          name: "Journal Entry",
          prefix: "JE-",
          companyId
        }
      ])
      .execute();
    await trx
      .insertInto("account")
      .values(
        ACCOUNTS.map((row) => ({
          id: account(row.name),
          name: row.name,
          class: row.class,
          incomeBalance:
            row.class === "Asset" ||
            row.class === "Liability" ||
            row.class === "Equity"
              ? ("Balance Sheet" as const)
              : ("Income Statement" as const),
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("accountDefault")
      .values({
        companyId,
        ...Object.fromEntries(
          FILLER_ACCOUNT_DEFAULTS.map((column) => [column, account("filler")])
        ),
        rawMaterialsAccount: account("inventory"),
        finishedGoodsAccount: account("finished-goods"),
        workInProgressAccount: account("wip"),
        receivablesAccount: account("receivables"),
        bankCashAccount: account("bank"),
        goodsReceivedNotInvoicedAccount: account("grni"),
        payablesAccount: account("payables"),
        retainedEarningsAccount: account("retained-earnings"),
        salesAccount: account("sales"),
        costOfGoodsSoldAccount: account("cogs")
      } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy: USER })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Headquarters",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: TIME_ZONE,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values([
        {
          id: partId,
          readableId: `${prefix}-PART`,
          name: "Bracket",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId,
          createdBy: USER
        },
        {
          id: serviceId,
          readableId: `${prefix}-SVC`,
          name: "Installation",
          type: "Service",
          itemTrackingType: "Non-Inventory",
          companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .updateTable("itemCost")
      .set({ costingMethod: "FIFO", unitCost: 10 })
      .where("itemId", "=", partId)
      .where("companyId", "=", companyId)
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: `${prefix} customer`, companyId })
      .execute();
    await trx
      .insertInto("supplier")
      .values({ id: supplierId, name: `${prefix} supplier`, companyId })
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });
  const today = datetime.today(TIME_ZONE);

  return {
    db,
    ctx,
    today: today.toString(),
    // Every document of the fixture is dated today, before this cutover.
    cutoverDate: today.add({ days: 1 }).toString(),
    prefix,
    companyId,
    locationId,
    partId,
    serviceId,
    customerId,
    supplierId,
    account,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("salesInvoice")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("purchaseInvoice")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        // `reimbursement_draft_guard` refuses to delete a Posted row.
        await trx
          .updateTable("reimbursement")
          .set({
            status: "Draft",
            journalId: null,
            postingDate: null,
            postedAt: null,
            postedBy: null
          })
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

type Fixture = Awaited<ReturnType<typeof cutoverReadsFixture>>;

function unwrap<T>(result: { data: T | null; error: Error | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Receives 10 parts at 10 on a purchase order; returns the PO line id. */
async function receiveTenParts(f: Fixture): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po`;
  const purchaseOrderLine = await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-1",
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
    return trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 10,
        supplierUnitPrice: 10,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
  const receipt = unwrap(
    await create(f.ctx, {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }));
  return purchaseOrderLine.id;
}

/** Invoices 4 of the 10 received parts at 10; returns the invoice id. */
async function invoiceFourParts(
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
      .values({
        invoiceId,
        invoiceLineType: "Part",
        itemId: f.partId,
        purchaseOrderId: `${f.prefix}-po`,
        purchaseOrderLineId,
        quantity: 4,
        supplierUnitPrice: 10,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** Ships 4 parts on a sales order. */
async function shipFourParts(f: Fixture) {
  const salesOrderId = `${f.prefix}-so`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId: "SO-1",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesOrderShipment")
      .values({ id: salesOrderId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        salesOrderId,
        salesOrderLineType: "Part",
        itemId: f.partId,
        saleQuantity: 4,
        unitPrice: 25,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await create(f.ctx, {
      type: "shipmentFromSalesOrder",
      salesOrderId,
      locationId: f.locationId
    })
  );
  unwrap(await postShipment(f.ctx, { type: "post", shipmentId: shipment.id }));
}

/** A sales invoice with one service line of 100, Draft or posted. */
async function serviceInvoice(
  f: Fixture,
  { id, post }: { id: string; post: boolean }
): Promise<string> {
  const invoiceId = `${f.prefix}-${id}`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: id.toUpperCase(),
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        postingDate: f.today,
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
        invoiceLineType: "Service",
        itemId: f.serviceId,
        quantity: 1,
        unitPrice: 100,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  if (post) unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** The customer pays 40 of the invoice. */
async function payForty(f: Fixture, invoiceId: string) {
  await pay(f, invoiceId, { total: 40, applied: 40 });
}

/** The customer pays `total`, `applied` of it against the invoice; returns the payment id. */
async function pay(
  f: Fixture,
  invoiceId: string,
  { total, applied }: { total: number; applied: number }
): Promise<string> {
  const paymentId = `${f.prefix}-payment`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId: "PAY-1",
        paymentType: "Receipt",
        customerId: f.customerId,
        paymentDate: f.today,
        postingDate: f.today,
        currencyCode: "USD",
        totalAmount: total,
        exchangeRate: 1,
        bankAccount: f.account("bank"),
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("invoiceSettlement")
      .values({
        paymentId,
        targetSalesInvoiceId: invoiceId,
        sourceAmount: applied,
        appliedAmount: applied,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        appliedDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postPayment(f.ctx, { type: "post", paymentId }));
  return paymentId;
}

/**
 * Turns a posted payment into a legacy one, as the accounting reset left
 * every payment posted before it: the payment stays Posted with no journal.
 */
async function dropPaymentJournal(f: Fixture, paymentId: string) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const payment = await trx
      .selectFrom("payment")
      .select("journalId")
      .where("id", "=", paymentId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    if (!payment.journalId) throw new Error("The payment has no journal");
    await trx
      .updateTable("payment")
      .set({ journalId: null })
      .where("id", "=", paymentId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .deleteFrom("journalLineDimension")
      .where("companyId", "=", f.companyId)
      .where("journalLineId", "in", (eb) =>
        eb
          .selectFrom("journalLine")
          .select("id")
          .where("journalId", "=", payment.journalId)
      )
      .execute();
    await trx
      .deleteFrom("journalLine")
      .where("journalId", "=", payment.journalId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .deleteFrom("journal")
      .where("id", "=", payment.journalId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

describe("cutoverDateReason", () => {
  const timeZone = "UTC";
  const today = datetime.today(timeZone);
  const firstOfMonth = today.set({ day: 1 });

  it("accepts the first day of the current period", () => {
    expect(cutoverDateReason(firstOfMonth.toString(), timeZone)).toBeNull();
  });

  it("accepts the first day of a period three periods back", () => {
    expect(
      cutoverDateReason(
        firstOfMonth.subtract({ months: 3 }).toString(),
        timeZone
      )
    ).toBeNull();
  });

  it("refuses a date four periods back", () => {
    expect(
      cutoverDateReason(
        firstOfMonth.subtract({ months: 4 }).toString(),
        timeZone
      )
    ).toBe("cutover-date-too-far-back");
  });

  it("refuses a date that is not the first day of a period", () => {
    expect(
      cutoverDateReason(
        firstOfMonth.subtract({ months: 1 }).add({ days: 1 }).toString(),
        timeZone
      )
    ).toBe("cutover-date-not-period-start");
  });

  it("refuses a date that is not a date", () => {
    expect(cutoverDateReason("2026-02-30", timeZone)).toBe(
      "cutover-date-invalid"
    );
  });

  it("refuses a date after today", () => {
    expect(
      cutoverDateReason(firstOfMonth.add({ months: 1 }).toString(), timeZone)
    ).toBe("cutover-date-after-today");
  });
});

databaseTest(
  "readiness flags a Draft invoice dated before the cutover and an empty Migration Clearing default",
  async () => {
    const f = await cutoverReadsFixture();
    try {
      const draftId = await serviceInvoice(f, { id: "inv-draft", post: false });

      const { checks, passed } = await getActivationReadiness(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      const check = (key: string) => checks.find((c) => c.key === key)!;

      expect(passed).toBe(false);
      expect(check("pending-documents")).toMatchObject({
        passed: false,
        count: 1,
        items: [
          {
            type: "Sales Invoice",
            id: draftId,
            readableId: "INV-DRAFT",
            status: "Draft"
          }
        ]
      });
      expect(check("account-defaults").passed).toBe(false);
      expect(check("account-defaults").items.map((item) => item.id)).toContain(
        "migrationClearingAccount"
      );
      expect(check("account-defaults").detail).toContain(
        "migrationClearingAccount"
      );
      // No journals yet, so L is now and the company has no jobs.
      expect(check("legacy-jobs").passed).toBe(true);
      expect(check("opening-balance").passed).toBe(true);
      // The fixture has no fiscal year settings.
      expect(check("fiscal-settings")).toMatchObject({
        passed: false,
        reasons: ["no-fiscal-year-settings"]
      });
      // Tomorrow is after today, and not the first of a month unless today
      // is the last.
      expect(check("cutover-date").passed).toBe(false);
      expect(check("cutover-date").reasons).toEqual([
        cutoverDateReason(f.cutoverDate, TIME_ZONE)
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "open items, inventory and Migration Clearing at the cutover",
  async () => {
    const f = await cutoverReadsFixture();
    try {
      const purchaseOrderLineId = await receiveTenParts(f);
      const purchaseInvoiceId = await invoiceFourParts(f, purchaseOrderLineId);
      await shipFourParts(f);
      // A job return of 2 at 50: a positive "Job Consumption" cost row, which
      // `calculateCOGS` never relieves (`isCostLayer`). Read as a layer, it
      // would value the newest 2 of the 6 on hand at 50.
      await f.db
        .insertInto("costLedger")
        .values({
          companyId: f.companyId,
          itemId: f.partId,
          itemLedgerType: "Consumption",
          costLedgerType: "Direct Cost",
          documentType: "Job Consumption",
          documentId: `${f.prefix}-job`,
          quantity: 2,
          cost: 100,
          remainingQuantity: 0,
          postingDate: f.today
        })
        .execute();
      const invoiceId = await serviceInvoice(f, { id: "inv-1", post: true });
      await payForty(f, invoiceId);

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };

      // The invoice of 100 with 40 paid before the cutover keeps its
      // original amount and the settled part. Of the 10 received, 4 are
      // invoiced: the received line carries all 10, the cleared part sits on
      // the purchase invoice's reference with its quantity.
      const items = await getCutoverOpenItems(f.db, args);
      expect(items).toHaveLength(3);
      expect(items).toContainEqual({
        openItemType: "Receivable",
        accountId: f.account("receivables"),
        accountClass: "Asset",
        amount: 60,
        originalAmount: 100,
        settledBeforeCutover: 40,
        documentType: "Invoice",
        documentId: invoiceId,
        documentLineReference: null,
        description: "Accounts Receivable"
      });
      expect(items).toContainEqual({
        openItemType: "Received Not Invoiced",
        accountId: f.account("grni"),
        accountClass: "Liability",
        amount: 60,
        originalAmount: 100,
        settledBeforeCutover: 40,
        documentType: null,
        documentId: null,
        documentLineReference: journalReference.to.receipt(purchaseOrderLineId),
        description: "Goods Received Not Invoiced",
        quantity: 10,
        settled: {
          documentLineReference:
            journalReference.to.purchaseInvoice(purchaseOrderLineId),
          description: "GR/IR Clearing",
          quantity: 4
        }
      });
      expect(items).toContainEqual({
        openItemType: "Payable",
        accountId: f.account("payables"),
        accountClass: "Liability",
        amount: 40,
        originalAmount: 40,
        settledBeforeCutover: 0,
        documentType: "Invoice",
        documentId: purchaseInvoiceId,
        documentLineReference: null,
        description: "Accounts Payable"
      });

      // 10 received, 4 shipped: 6 on hand at the receipt's layer cost; the
      // job return is not a layer.
      const inventory = await getCutoverInventory(f.db, args);
      expect(inventory).toEqual([
        {
          itemId: f.partId,
          readableId: `${f.prefix}-PART`,
          name: "Bracket",
          quantity: 6,
          unitCost: 10,
          costingMethod: "FIFO",
          inventoryAccountId: f.account("inventory")
        }
      ]);

      // A trial balance that agrees with Carbon on every control account.
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("receivables"), debit: 60, credit: 0 },
          { accountId: f.account("inventory"), debit: 60, credit: 0 },
          { accountId: f.account("bank"), debit: 40, credit: 0 },
          { accountId: f.account("grni"), debit: 0, credit: 60 },
          { accountId: f.account("payables"), debit: 0, credit: 40 },
          { accountId: f.account("retained-earnings"), debit: 0, credit: 60 }
        ]
      });
      const clearing = await getMigrationClearing(f.db, args);
      expect(clearing.total).toBe(0);
      for (const row of clearing.rows) {
        expect({
          accountId: row.accountId,
          difference: row.difference
        }).toEqual({ accountId: row.accountId, difference: 0 });
      }
      expect(
        clearing.rows.find((row) => row.accountId === f.account("receivables"))
      ).toEqual({
        accountId: f.account("receivables"),
        trialBalance: 60,
        carbon: 60,
        difference: 0
      });

      // Saving again replaces the Draft's lines; one Draft journal, dated the
      // day before the cutover, with no period.
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("receivables"), debit: 65, credit: 0 },
          { accountId: f.account("inventory"), debit: 60, credit: 0 },
          { accountId: f.account("bank"), debit: 40, credit: 0 },
          { accountId: f.account("grni"), debit: 0, credit: 60 },
          { accountId: f.account("payables"), debit: 0, credit: 40 },
          { accountId: f.account("retained-earnings"), debit: 0, credit: 65 }
        ]
      });
      const drafts = await f.db
        .selectFrom("journal")
        .select(["id", "postingDate", "accountingPeriodId"])
        .where("companyId", "=", f.companyId)
        .where("status", "=", "Draft")
        .where("sourceType", "=", "Opening Balance")
        .execute();
      expect(drafts).toEqual([
        {
          id: drafts[0]!.id,
          postingDate: f.today,
          accountingPeriodId: null
        }
      ]);
      const changed = await getMigrationClearing(f.db, args);
      expect(
        changed.rows.find((row) => row.accountId === f.account("receivables"))
          ?.difference
      ).toBe(5);
      // The difference stays on Migration Clearing.
      expect(changed.total).toBe(5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a legacy payment's unapplied cash opens on account, as its journal would have booked it",
  async () => {
    const f = await cutoverReadsFixture();
    try {
      const invoiceId = await serviceInvoice(f, { id: "inv-1", post: true });
      // 50 received, 40 applied to the invoice of 100: 10 on account.
      const paymentId = await pay(f, invoiceId, { total: 50, applied: 40 });
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const onAccount = {
        openItemType: "Unapplied Credit",
        accountId: f.account("receivables"),
        accountClass: "Asset",
        // A credit on receivables.
        amount: -10,
        originalAmount: -10,
        settledBeforeCutover: 0,
        documentType: "Payment",
        documentId: paymentId,
        documentLineReference: null,
        description: "Accounts Receivable (on-account credit)"
      };

      // With its journal: the on-account line the journal wrote.
      const journaled = await getCutoverOpenItems(f.db, args);
      expect(journaled).toContainEqual(onAccount);

      // Without it: the same number, from the payment and its settlement.
      await dropPaymentJournal(f, paymentId);
      const legacy = await getCutoverOpenItems(f.db, args);
      expect(legacy).toContainEqual(onAccount);
      expect(legacy).toHaveLength(journaled.length);
      expect(
        legacy.find((item) => item.documentId === invoiceId)
      ).toMatchObject({ amount: 60, settledBeforeCutover: 40 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reimbursement partly paid out before the cutover opens on its payable account",
  async () => {
    const f = await cutoverReadsFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          employeeReimbursementsPayableAccount: f.account("employee-payable")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const employeeId = await insertEmployee(f);
      const reimbursement = (id: string, amount: number) =>
        postReimbursementOf(f, {
          id,
          employeeId,
          amount,
          expenseAccountId: f.account("cogs")
        });
      const payOut = (id: string, reimbursementId: string, amount: number) =>
        payOutReimbursement(f, {
          id,
          employeeId,
          reimbursementId,
          amount,
          bankAccountId: f.account("bank")
        });

      // 100 owed, 40 paid out: 60 open. 30 owed and paid out in full: not
      // open.
      const openId = await reimbursement("re-1", 100);
      await payOut("payout-1", openId, 40);
      const paidId = await reimbursement("re-2", 30);
      await payOut("payout-2", paidId, 30);

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const items = await getCutoverOpenItems(f.db, args);
      expect(items).toEqual([
        {
          openItemType: "Reimbursement",
          accountId: f.account("employee-payable"),
          accountClass: "Liability",
          amount: 60,
          originalAmount: 100,
          settledBeforeCutover: 40,
          documentType: "Reimbursement",
          documentId: openId,
          documentLineReference: null,
          // The description the payout's control lookup matches.
          description: REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION
        }
      ]);

      // The payable is a control account: the trial balance asserts it, and
      // Migration Clearing compares the assertion with the open item.
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("employee-payable"), debit: 0, credit: 60 },
          { accountId: f.account("retained-earnings"), debit: 60, credit: 0 }
        ]
      });
      const clearing = await getMigrationClearing(f.db, args);
      expect(clearing.controlAccountIds).toContain(
        f.account("employee-payable")
      );
      expect(
        clearing.rows.find(
          (row) => row.accountId === f.account("employee-payable")
        )
      ).toEqual({
        accountId: f.account("employee-payable"),
        trialBalance: -60,
        carbon: -60,
        difference: 0
      });
      expect(clearing.total).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "readiness refuses a Migration Clearing default that is not an Equity posting account",
  async () => {
    const f = await cutoverReadsFixture();
    try {
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const setClearing = (accountId: string) =>
        f.db
          .updateTable("accountDefault")
          .set({ migrationClearingAccount: accountId })
          .where("companyId", "=", f.companyId)
          .execute();
      const clearingItem = async () => {
        const { checks } = await getActivationReadiness(f.db, args);
        const check = checks.find((c) => c.key === "account-defaults")!;
        return {
          detail: check.detail,
          reasons: check.reasons,
          item: check.items.find((i) => i.id === "migrationClearingAccount")
        };
      };

      // An asset account.
      await setClearing(f.account("filler"));
      const asset = await clearingItem();
      expect(asset.item?.status).toBe("migration-clearing-wrong-kind");
      expect(asset.reasons).toEqual(["migration-clearing-wrong-kind"]);
      expect(asset.detail).toContain(
        "Set migrationClearingAccount to an active Equity account that is not a group."
      );

      // An Equity account passes.
      await setClearing(f.account("retained-earnings"));
      expect((await clearingItem()).item).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  }
);
