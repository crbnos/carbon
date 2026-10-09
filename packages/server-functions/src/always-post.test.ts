// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A company with no accounting cutover posts every document type against the
// live database. Each posting writes its journal as Provisional with no
// accounting period, no accounting period is ever created, and the general
// ledger balances stay at zero because a Provisional journal counts nowhere.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Insertable, sql } from "kysely";
import { expect } from "vitest";
import create from "./create";
import issue from "./issue";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./local-database-test-fixture";
import postInventoryAdjustment from "./post-inventory-adjustment";
import postMemo from "./post-memo";
import postPayment from "./post-payment";
import postPurchaseInvoice from "./post-purchase-invoice";
import postReceipt from "./post-receipt";
import { FILLER_ACCOUNT_DEFAULTS } from "./post-reimbursement/post-reimbursement-test-fixture";
import postSalesInvoice from "./post-sales-invoice";
import postShipment from "./post-shipment";
import { ServerFnContext } from "./server-fn-context";

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
  { name: "retained-earnings", class: "Equity" },
  { name: "sales", class: "Revenue" },
  { name: "cogs", class: "Expense" },
  { name: "adjustment-variance", class: "Expense" },
  { name: "sales-discount", class: "Expense" },
  { name: "supplies", class: "Expense" },
  { name: "scrap", class: "Expense" }
] as const;

type AccountName = (typeof ACCOUNTS)[number]["name"];

/** A company with a chart of accounts, account defaults, one location, a
 *  bought stock part, a made assembly and a service item. It has no
 *  accounting cutover and no accounting period. */
async function alwaysPostFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `alwayspost-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const locationId = `${prefix}-location`;
  const partId = `${prefix}-part`;
  const assemblyId = `${prefix}-assembly`;
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
    // The company insert creates its settings row. Leave the cutover empty.
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
        costOfGoodsSoldAccount: account("cogs"),
        inventoryAdjustmentVarianceAccount: account("adjustment-variance"),
        salesDiscountAccount: account("sales-discount"),
        scrapAccount: account("scrap")
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
          id: assemblyId,
          readableId: `${prefix}-ASSY`,
          name: "Assembly",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Make",
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
    // The item insert creates a FIFO itemCost row; give the part a cost.
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
  const today = datetime.today(TIME_ZONE).toString();

  return {
    db,
    ctx,
    today,
    prefix,
    companyId,
    groupId,
    locationId,
    partId,
    assemblyId,
    serviceId,
    customerId,
    supplierId,
    account,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // The posted-invoice deletion guards refuse a cascade delete of a
        // posted invoice. Walk the test's invoices back to Draft first.
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

type Fixture = Awaited<ReturnType<typeof alwaysPostFixture>>;

function unwrap<T>(result: { data: T | null; error: Error | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Every journal the filter selects is Provisional, has no accounting period
 *  and has lines; there is at least one; the company has no period. */
async function expectProvisional(
  f: Fixture,
  filter: { sourceType: string } | { journalIds: string[] }
) {
  let query = f.db
    .selectFrom("journal")
    .select(["id", "status", "accountingPeriodId"])
    .where("companyId", "=", f.companyId);
  query =
    "sourceType" in filter
      ? query.where("sourceType", "=", filter.sourceType as never)
      : query.where("id", "in", filter.journalIds);
  const journals = await query.execute();
  expect(journals.length).toBeGreaterThan(0);
  for (const journal of journals) {
    expect(journal.status).toEqual("Provisional");
    expect(journal.accountingPeriodId).toBeNull();
  }
  const lines = await f.db
    .selectFrom("journalLine")
    .select("journalId")
    .distinct()
    .where("companyId", "=", f.companyId)
    .where(
      "journalId",
      "in",
      journals.map((journal) => journal.id)
    )
    .execute();
  expect(lines.length).toEqual(journals.length);
  expect(await countAccountingPeriods(f)).toBe(0);
}

async function countAccountingPeriods(f: Fixture): Promise<number> {
  const row = await f.db
    .selectFrom("accountingPeriod")
    .select(sql<number>`count(*)::int`.as("count"))
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

async function receiveFromPurchaseOrder(f: Fixture): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po`;
  await f.db.transaction().execute(async (trx) => {
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
    await trx
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
      .execute();
  });
  const receipt = unwrap(
    await create(f.ctx, {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }));
  return receipt.id;
}

async function shipSalesOrder(f: Fixture): Promise<string> {
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
  return shipment.id;
}

async function postServiceInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-sales-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "INV-1",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
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
  unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

async function postSuppliesInvoice(f: Fixture): Promise<string> {
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
        invoiceLineType: "G/L Account",
        accountId: f.account("supplies"),
        quantity: 1,
        supplierUnitPrice: 60,
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

async function payInvoice(f: Fixture, invoiceId: string): Promise<string> {
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
        totalAmount: 100,
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
        sourceAmount: 100,
        appliedAmount: 100,
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

async function postCreditMemo(f: Fixture): Promise<string> {
  const memoId = `${f.prefix}-memo`;
  await f.db
    .insertInto("memo")
    .values({
      id: memoId,
      memoId: "CM-1",
      customerId: f.customerId,
      direction: "Credit",
      memoDate: f.today,
      currencyCode: "USD",
      exchangeRate: 1,
      amount: 20,
      companyId: f.companyId,
      createdBy: USER
    })
    .execute();
  unwrap(await postMemo(f.ctx, { type: "post", memoId }));
  return memoId;
}

/** A job for one assembly, one operation, and one planned material: two of
 *  the part. */
async function jobFixture(f: Fixture) {
  const jobId = `${f.prefix}-job`;
  const processId = `${f.prefix}-process`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("job")
      .values({
        id: jobId,
        jobId: "J-1",
        itemId: f.assemblyId,
        quantity: 1,
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: "Assemble",
        defaultStandardFactor: "Hours/Piece",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  // The job insert creates its top-level make method.
  const makeMethod = await f.db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const operation = await f.db
    .insertInto("jobOperation")
    .values({
      jobId,
      jobMakeMethodId: makeMethod.id,
      processId,
      description: "Assemble",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const material = await f.db
    .insertInto("jobMaterial")
    .values({
      jobId,
      jobMakeMethodId: makeMethod.id,
      jobOperationId: operation.id,
      itemId: f.partId,
      itemType: "Part",
      methodType: "Pull from Inventory",
      description: "Bracket",
      quantity: 2,
      estimatedQuantity: 2,
      unitOfMeasureCode: "EA",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { jobId, operationId: operation.id, materialId: material.id };
}

databaseTest(
  "a company with no accounting cutover posts every document as Provisional, with no period",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Receipt: 10 parts at 10 from a purchase order.
      await receiveFromPurchaseOrder(f);
      await expectProvisional(f, { sourceType: "Purchase Receipt" });

      // Shipment: 4 parts on a sales order, costed from the receipt's layer.
      const shipmentId = await shipSalesOrder(f);
      await expectProvisional(f, { sourceType: "Sales Shipment" });
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["itemId", "quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Sale")
        .where("documentId", "=", shipmentId)
        .execute();
      expect(
        sale.map((row) => ({
          itemId: row.itemId,
          quantity: Number(row.quantity),
          cost: Number(row.cost)
        }))
      ).toEqual([{ itemId: f.partId, quantity: -4, cost: -40 }]);

      // Sales invoice: one service line of 100.
      const salesInvoiceId = await postServiceInvoice(f);
      await expectProvisional(f, { sourceType: "Sales Invoice" });

      // Purchase invoice: one G/L line of 60.
      await postSuppliesInvoice(f);
      await expectProvisional(f, { sourceType: "Purchase Invoice" });

      // Payment: the customer pays the sales invoice in full.
      const paymentId = await payInvoice(f, salesInvoiceId);
      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", paymentId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(payment.status).toEqual("Posted");
      await expectProvisional(f, { journalIds: [payment.journalId!] });

      // Memo: a standalone credit of 20.
      const memoId = await postCreditMemo(f);
      const memo = await f.db
        .selectFrom("memo")
        .select(["status", "journalId"])
        .where("id", "=", memoId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(memo.status).toEqual("Posted");
      await expectProvisional(f, { journalIds: [memo.journalId!] });

      // Inventory adjustment: remove one part.
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Negative Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 1
        })
      );
      await expectProvisional(f, { sourceType: "Inventory Adjustment" });

      // Job material issue: two parts to the job's operation.
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
      await expectProvisional(f, { sourceType: "Job Consumption" });

      // Job completion: the assembly goes to inventory. There is no server
      // function for it; the ERP route, MCP and the finish-operation trigger
      // all call this SQL function.
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      await expectProvisional(f, { sourceType: "Job Receipt" });
      const completed = await f.db
        .selectFrom("job")
        .select("status")
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(completed.status).toEqual("Completed");

      // Every journal of the company: Provisional, no period.
      const statuses = await f.db
        .selectFrom("journal")
        .select(["status", "accountingPeriodId"])
        .distinct()
        .where("companyId", "=", f.companyId)
        .execute();
      expect(statuses).toEqual([
        { status: "Provisional", accountingPeriodId: null }
      ]);
      expect(await countAccountingPeriods(f)).toBe(0);

      // The journals carry real amounts, yet no account has a balance.
      const moved = await f.db
        .selectFrom("journalLine")
        .select(sql<number>`sum(abs("amount"))`.as("total"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(moved.total)).toBeGreaterThan(0);
      const balances = await sql<{
        accountId: string;
        balance: number;
        balanceAtDate: number;
        netChange: number;
      }>`SELECT * FROM "accountTreeBalances"(${f.groupId})`.execute(f.db);
      expect(balances.rows.length).toEqual(ACCOUNTS.length);
      for (const row of balances.rows) {
        expect({
          accountId: row.accountId,
          balance: Number(row.balance),
          balanceAtDate: Number(row.balanceAtDate),
          netChange: Number(row.netChange)
        }).toEqual({
          accountId: row.accountId,
          balance: 0,
          balanceAtDate: 0,
          netChange: 0
        });
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a scrap with no scrap account default posts a stand-in line on retained earnings",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Positive Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 5
        })
      );
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Scrap",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 2,
          scrapReasonId: scrapReason.id
        })
      );
      await expectProvisional(f, { sourceType: "Inventory Adjustment" });

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "accountDefaultRole"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Scrap")
        .orderBy("accountId")
        .execute();
      expect(
        lines.map((line) => ({ ...line, amount: Number(line.amount) }))
      ).toEqual([
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null
        },
        {
          accountId: f.account("retained-earnings"),
          amount: 20,
          accountDefaultRole: "scrapAccount"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
