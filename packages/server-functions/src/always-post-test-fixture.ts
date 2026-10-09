// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The company and documents the always-post tests share: a company with no
// accounting cutover, the documents it posts, and the reads the tests assert
// with. `stampCutover` gives the company a cutover and the period of the
// current month, so a test can post the same document again as Posted.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { endOfMonth } from "@internationalized/date";
import { type Insertable, sql, type Transaction } from "kysely";
import { expect } from "vitest";
import create from "./create";
import { connectLocalTestDatabase } from "./local-database-test-fixture";
import postInventoryAdjustment from "./post-inventory-adjustment";
import postMemo from "./post-memo";
import postPayment from "./post-payment";
import postPurchaseInvoice from "./post-purchase-invoice";
import postReceipt from "./post-receipt";
import { FILLER_ACCOUNT_DEFAULTS } from "./post-reimbursement/post-reimbursement-test-fixture";
import postSalesInvoice from "./post-sales-invoice";
import postShipment from "./post-shipment";
import { ServerFnContext } from "./server-fn-context";

export const USER = "system";
export const TIME_ZONE = "America/New_York";

export const ACCOUNTS = [
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
  { name: "scrap", class: "Expense" },
  { name: "labor-absorption", class: "Expense" }
] as const;

export type AccountName = (typeof ACCOUNTS)[number]["name"];

/** A company with a chart of accounts, account defaults, two locations, a
 *  bought stock part, a made assembly and a service item. It has no
 *  accounting cutover and no accounting period. The labor and overhead
 *  absorption defaults are empty. */
export async function alwaysPostFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `alwayspost-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const locationId = `${prefix}-location`;
  const otherLocationId = `${prefix}-location-2`;
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
      .values([
        {
          id: locationId,
          name: "Headquarters",
          addressLine1: "1 Main St",
          city: "Springfield",
          postalCode: "00000",
          timezone: TIME_ZONE,
          companyId,
          createdBy: USER
        },
        {
          id: otherLocationId,
          name: "Warehouse",
          addressLine1: "2 Main St",
          city: "Springfield",
          postalCode: "00000",
          timezone: TIME_ZONE,
          companyId,
          createdBy: USER
        }
      ])
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
  const today = datetime.today(TIME_ZONE);
  // The first day of the current month: on or before today, so a document
  // posted today is on or after the cutover and one dated the day before it
  // is before the cutover.
  const cutover = today.set({ day: 1 });

  return {
    db,
    ctx,
    today: today.toString(),
    cutoverDate: cutover.toString(),
    beforeCutover: cutover.subtract({ days: 1 }).toString(),
    periodEnd: endOfMonth(today).toString(),
    fiscalYear: today.year,
    periodNumber: today.month,
    prefix,
    companyId,
    groupId,
    locationId,
    otherLocationId,
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
        await trx
          .updateTable("journal")
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

export type Fixture = Awaited<ReturnType<typeof alwaysPostFixture>>;

export function unwrap<T>(result: { data: T | null; error: Error | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Runs `fn` with app.sync_in_progress on, as the fixture inserts need. */
export async function seed(
  f: Fixture,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<unknown>
) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await fn(trx);
  });
}

/** Gives the company a cutover on the first day of the current month and an
 *  open, active accounting period for the month. Returns the period id. */
export async function stampCutover(f: Fixture): Promise<string> {
  const periodId = `${f.prefix}-period`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("companySettings")
      .set({ accountingCutoverDate: f.cutoverDate })
      .where("id", "=", f.companyId)
      .execute();
    await trx
      .insertInto("accountingPeriod")
      .values({
        id: periodId,
        startDate: f.cutoverDate,
        endDate: f.periodEnd,
        fiscalYear: f.fiscalYear,
        periodNumber: f.periodNumber,
        status: "Active",
        closeStatus: "Open",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return periodId;
}

export async function countAccountingPeriods(f: Fixture): Promise<number> {
  const row = await f.db
    .selectFrom("accountingPeriod")
    .select(sql<number>`count(*)::int`.as("count"))
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export type JournalRow = {
  id: string;
  status: string;
  accountingPeriodId: string | null;
  sourceType: string | null;
};

/** The journals `action` writes: every journal of the company that did not
 *  exist before it ran. */
export async function newJournals(
  f: Fixture,
  action: () => Promise<unknown>
): Promise<JournalRow[]> {
  const before = new Set(
    (
      await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute()
    ).map((row) => row.id)
  );
  await action();
  const after = await f.db
    .selectFrom("journal")
    .select(["id", "status", "accountingPeriodId", "sourceType"])
    .where("companyId", "=", f.companyId)
    .orderBy("journalEntryId")
    .execute();
  return after.filter((row) => !before.has(row.id)) as JournalRow[];
}

async function expectLines(f: Fixture, journals: JournalRow[]) {
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
}

/** The action wrote at least one journal, every one of `sourceType`,
 *  Provisional, with no period and with lines; the company has no period. */
export async function expectProvisionalJournals(
  f: Fixture,
  journals: JournalRow[],
  sourceType: string
) {
  expect(journals.length).toBeGreaterThan(0);
  for (const journal of journals) {
    expect(journal).toMatchObject({
      sourceType,
      status: "Provisional",
      accountingPeriodId: null
    });
  }
  await expectLines(f, journals);
  expect(await countAccountingPeriods(f)).toBe(0);
}

/** The action wrote at least one journal, every one of `sourceType`, Posted
 *  in `periodId` and with lines; the posting created no other period. */
export async function expectPostedJournals(
  f: Fixture,
  journals: JournalRow[],
  sourceType: string,
  periodId: string
) {
  expect(journals.length).toBeGreaterThan(0);
  for (const journal of journals) {
    expect(journal).toMatchObject({
      sourceType,
      status: "Posted",
      accountingPeriodId: periodId
    });
  }
  await expectLines(f, journals);
  expect(await countAccountingPeriods(f)).toBe(1);
}

/** The lines of the given journals, amounts as numbers, ordered by account. */
export async function journalLinesOf(f: Fixture, journals: JournalRow[]) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount", "accountDefaultRole", "documentType"])
    .where("companyId", "=", f.companyId)
    .where(
      "journalId",
      "in",
      journals.map((journal) => journal.id)
    )
    .orderBy("accountId")
    .orderBy("amount")
    .execute();
  return lines.map((line) => ({ ...line, amount: Number(line.amount) }));
}

/** Puts `quantity` parts on hand at `locationId` with a positive adjustment. */
export async function stockPart(
  f: Fixture,
  quantity: number,
  locationId: string = f.locationId
) {
  unwrap(
    await postInventoryAdjustment(f.ctx, {
      adjustmentType: "Positive Adjmt.",
      itemId: f.partId,
      locationId,
      quantity
    })
  );
}

export async function receiveFromPurchaseOrder(
  f: Fixture,
  key = "1"
): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-${key}`;
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
        purchaseOrderId: `PO-${key}`,
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

export async function shipSalesOrder(f: Fixture, key = "1"): Promise<string> {
  const salesOrderId = `${f.prefix}-so-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId: `SO-${key}`,
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

export async function postServiceInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-sales-invoice`;
  await seed(f, async (trx) => {
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

export async function postSuppliesInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-purchase-invoice`;
  await seed(f, async (trx) => {
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

export async function payInvoice(
  f: Fixture,
  invoiceId: string
): Promise<string> {
  const paymentId = `${f.prefix}-payment`;
  await seed(f, async (trx) => {
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

export async function postCreditMemo(f: Fixture): Promise<string> {
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

/** A job for one assembly, one operation at a work center, and one planned
 *  material: two of the part per assembly. `key` keeps two jobs of one
 *  fixture apart. */
export async function jobFixture(f: Fixture, key = "1") {
  const jobId = `${f.prefix}-job-${key}`;
  const processId = `${f.prefix}-process-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("job")
      .values({
        id: jobId,
        jobId: `J-${key}`,
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
        name: `Assemble ${key}`,
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

/** A work center at the fixture's location with a labor rate of 60 an
 *  hour and no machine or overhead rate. */
export async function workCenterFixture(f: Fixture): Promise<string> {
  const workCenter = await f.db
    .insertInto("workCenter")
    .values({
      name: `${f.prefix} bench`,
      laborRate: 60,
      locationId: f.locationId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return workCenter.id;
}
