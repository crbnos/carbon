// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounting enable against the live database. A company with no cutover
// receives stock and invoices a customer before the cutover date, ships and
// scraps after it, enters a trial balance that ties, and enables. The
// Provisional ledger then splits at the cutover: Superseded before it, Posted
// in a period after it, with one Posted opening journal between them.

import {
  getCutoverInventory,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { GL_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import { OPTIONAL_DEFAULT_ROLES } from "@carbon/database/journal-posting-status";
import { datetime } from "@carbon/utils";
import { type Insertable, sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import postInventoryAdjustment from "../post-inventory-adjustment";
import postPayment from "../post-payment";
import postReceipt from "../post-receipt";
import { FILLER_ACCOUNT_DEFAULTS } from "../post-reimbursement/post-reimbursement-test-fixture";
import postSalesInvoice from "../post-sales-invoice";
import postShipment from "../post-shipment";
import { ServerFnContext } from "../server-fn-context";
import activateAccounting from ".";

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
  { name: "migration-clearing", class: "Equity" },
  { name: "sales", class: "Revenue" },
  { name: "cogs", class: "Expense" },
  { name: "scrap", class: "Expense" }
] as const;

type AccountName = (typeof ACCOUNTS)[number]["name"];

/** A company with no accounting cutover: every account default set except
 *  the scrap account, fiscal year settings, a FIFO stock part, a service
 *  item, a customer and a supplier. */
async function activationFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `activate-${crypto
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
      .insertInto("fiscalYearSettings")
      .values({ companyId, startMonth: "January", updatedBy: USER })
      .onConflict((oc) => oc.column("companyId").doNothing())
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
          [...FILLER_ACCOUNT_DEFAULTS, ...OPTIONAL_DEFAULT_ROLES].map(
            (column) => [column, account("filler")]
          )
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
        migrationClearingAccount: account("migration-clearing"),
        // Empty, so the scrap after the cutover date posts a stand-in line.
        scrapAccount: null
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
  // The first day of the current period: on or before today, and the
  // documents moved to the day before it are in the previous period.
  const cutover = today.set({ day: 1 });

  return {
    db,
    ctx,
    today: today.toString(),
    cutoverDate: cutover.toString(),
    beforeCutover: cutover.subtract({ days: 1 }).toString(),
    prefix,
    companyName: prefix,
    companyId,
    groupId,
    locationId,
    partId,
    serviceId,
    customerId,
    supplierId,
    account,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // Posted and Superseded journals are immutable, and a Closed period
        // refuses their delete. Walk them back with triggers off, then let
        // the company delete cascade normally.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("accountingPeriod")
          .set({ closeStatus: "Open", closedAt: null })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("salesInvoice")
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

type Fixture = Awaited<ReturnType<typeof activationFixture>>;

function unwrap<T>(result: { data: T | null; error: Error | null }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Receives 5 parts at `unitPrice` on a purchase order of its own. */
async function receiveFiveParts(
  f: Fixture,
  { id, unitPrice }: { id: string; unitPrice: number }
): Promise<string> {
  const purchaseOrderId = `${f.prefix}-${id}`;
  const line = await f.db.transaction().execute(async (trx) => {
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
        purchaseOrderId: id.toUpperCase(),
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
        purchaseQuantity: 5,
        supplierUnitPrice: unitPrice,
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
  return line.id;
}

/** A posted sales invoice with one service line of 100. */
async function postServiceInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-invoice`;
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
  unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** The customer pays `amount` of the invoice. */
async function pay(
  f: Fixture,
  { id, invoiceId, amount }: { id: string; invoiceId: string; amount: number }
): Promise<string> {
  const paymentId = `${f.prefix}-${id}`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId: id.toUpperCase(),
        paymentType: "Receipt",
        customerId: f.customerId,
        paymentDate: f.today,
        postingDate: f.today,
        currencyCode: "USD",
        totalAmount: amount,
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
        sourceAmount: amount,
        appliedAmount: amount,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        appliedDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return paymentId;
}

/** Moves everything the company has posted so far to the day before the
 *  cutover, as if it had been posted then. */
async function moveBeforeCutover(f: Fixture) {
  const date = f.beforeCutover;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const table of [
      "journal",
      "itemLedger",
      "costLedger",
      "receipt",
      "salesInvoice"
    ] as const) {
      await trx
        .updateTable(table)
        .set({ postingDate: date })
        .where("companyId", "=", f.companyId)
        .execute();
    }
    await trx
      .updateTable("payment")
      .set({ postingDate: date, paymentDate: date })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .updateTable("invoiceSettlement")
      .set({ appliedDate: date })
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

/** Ships 5 parts on a sales order, today. */
async function shipFiveParts(f: Fixture): Promise<string> {
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
        saleQuantity: 5,
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

const CLASS_BY_ACCOUNT_NAME = new Map(
  ACCOUNTS.map((row) => [row.name, row.class])
);

/** Debit-signed value of a natural-balance-signed line. */
function debitOf(f: Fixture, accountId: string | null, amount: number) {
  const name = (accountId ?? "").slice(f.prefix.length + 1) as AccountName;
  const accountClass = CLASS_BY_ACCOUNT_NAME.get(name);
  return accountClass === "Asset" || accountClass === "Expense"
    ? amount
    : -amount;
}

/** The balance of an account over the Posted and Reversed journals. */
async function glBalance(f: Fixture, name: AccountName) {
  const row = await f.db
    .selectFrom("journalLine as line")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select(sql<number>`coalesce(sum("line"."amount"), 0)`.as("balance"))
    .where("line.companyId", "=", f.companyId)
    .where("line.accountId", "=", f.account(name))
    .where("journal.status", "in", [...GL_JOURNAL_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

databaseTest(
  "enabling accounting splits the Provisional ledger at the cutover and opens it with one journal",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts at 8 and 5 at 12 received and not
      // invoiced; an invoice of 100 with 40 paid.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      const invoiceId = await postServiceInvoice(f);
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, { id: "pay-1", invoiceId, amount: 40 })
        })
      );
      await moveBeforeCutover(f);

      // On or after the cutover: ship 5 parts, and scrap 1 while the scrap
      // account default is empty.
      const shipmentId = await shipFiveParts(f);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Scrap",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 1,
          scrapReasonId: scrapReason.id
        })
      );
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();

      // The trial balance at the day before the cutover, tied to Carbon's
      // open items and its reviewed inventory value.
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const [part] = await getCutoverInventory(f.db, args);
      expect(part).toMatchObject({ itemId: f.partId, quantity: 10 });
      const unitCost = part!.unitCost;
      const inventoryValue = 10 * unitCost;
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("receivables"), debit: 60, credit: 0 },
          {
            accountId: f.account("inventory"),
            debit: inventoryValue,
            credit: 0
          },
          { accountId: f.account("bank"), debit: 40, credit: 0 },
          { accountId: f.account("grni"), debit: 0, credit: 100 },
          {
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: inventoryValue
          }
        ]
      });

      // A wrong confirmation changes nothing.
      const refused = await activateAccounting(f.ctx, {
        ...args,
        confirmation: "not the company"
      });
      expect(refused.error?.message).toBe("Type the company name to confirm.");

      unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );

      const journals = await f.db
        .selectFrom("journal")
        .select([
          "id",
          "status",
          "postingDate",
          "sourceType",
          "description",
          "accountingPeriodId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();

      // No Provisional journal remains; nothing is left Draft either (the
      // trial balance became the opening journal).
      expect(journals.map((journal) => journal.status).sort()).not.toContain(
        "Provisional"
      );
      expect(journals.map((journal) => journal.status)).not.toContain("Draft");

      const opening = journals.filter(
        (journal) => journal.sourceType === "Opening Balance"
      );
      expect(opening).toHaveLength(1);
      expect(opening[0]).toMatchObject({
        status: "Posted",
        postingDate: f.beforeCutover
      });
      expect(opening[0]!.accountingPeriodId).not.toBeNull();

      // Before the cutover: Superseded, with no period. On or after it:
      // Posted, in a period.
      for (const journal of journals) {
        if (journal.sourceType === "Opening Balance") continue;
        if (String(journal.postingDate) < f.cutoverDate) {
          expect(journal).toMatchObject({
            status: "Superseded",
            accountingPeriodId: null
          });
        } else {
          expect(journal.status).toBe("Posted");
          expect(journal.accountingPeriodId).not.toBeNull();
        }
      }
      expect(
        journals.filter((journal) => journal.status === "Superseded").length
      ).toBeGreaterThanOrEqual(4);

      // The opening journal balances, and Migration Clearing nets to zero.
      const openingLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "description", "documentLineReference"])
        .where("companyId", "=", f.companyId)
        .where("journalId", "=", opening[0]!.id)
        .execute();
      const imbalance = openingLines.reduce(
        (sum, line) => sum + debitOf(f, line.accountId, Number(line.amount)),
        0
      );
      expect(imbalance).toBeCloseTo(0, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
      expect(await glBalance(f, "receivables")).toBeCloseTo(60, 6);
      expect(await glBalance(f, "grni")).toBeCloseTo(100, 6);

      // No Posted line is a stand-in: the scrap moved to the scrap account.
      const standIns = await f.db
        .selectFrom("journalLine as line")
        .innerJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "line.journalId")
            .onRef("journal.companyId", "=", "line.companyId")
        )
        .select("line.id")
        .where("line.companyId", "=", f.companyId)
        .where("journal.status", "=", "Posted")
        .where("line.accountDefaultRole", "is not", null)
        .execute();
      expect(standIns).toEqual([]);
      expect(await glBalance(f, "scrap")).toBeCloseTo(unitCost, 6);

      // The shipment after the cutover costs 5 at the reset unit cost, in
      // its cost layer row and in its journals.
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["cost", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", shipmentId)
        .executeTakeFirstOrThrow();
      expect(Number(sale.cost)).toBeCloseTo(-5 * unitCost, 6);
      // The shipment relieved the 8-cost layer (40) and the scrap the
      // 12-cost layer. The reset values the 10 parts on hand at the cutover
      // at 5 × 8 + 5 × 12 = 100, so a recost journal moves each difference.
      expect(unitCost).toBe(10);
      expect(
        journals.filter(
          (journal) =>
            journal.description === "Cutover recost" &&
            journal.status === "Posted"
        )
      ).toHaveLength(2);
      expect(await glBalance(f, "cogs")).toBeCloseTo(5 * unitCost, 6);
      // Opening stock less what left after the cutover, on the account and
      // on the one open layer.
      expect(await glBalance(f, "inventory")).toBeCloseTo(4 * unitCost, 6);
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "remainingQuantity", "postingDate"])
        .where("companyId", "=", f.companyId)
        .where("remainingQuantity", ">", 0)
        .execute();
      expect(
        layers.map((layer) => ({
          quantity: Number(layer.quantity),
          remainingQuantity: Number(layer.remainingQuantity),
          postingDate: layer.postingDate
        }))
      ).toEqual([
        { quantity: 10, remainingQuantity: 4, postingDate: f.cutoverDate }
      ]);

      // Every period before the cutover is Closed.
      const periods = await f.db
        .selectFrom("accountingPeriod")
        .select(["endDate", "closeStatus"])
        .where("companyId", "=", f.companyId)
        .execute();
      const before = periods.filter(
        (period) => String(period.endDate) < f.cutoverDate
      );
      expect(before.length).toBeGreaterThan(0);
      for (const period of before) expect(period.closeStatus).toBe("Closed");

      const settings = await f.db
        .selectFrom("companySettings")
        .select(["accountingCutoverDate", "accountingActivatedBy"])
        .where("id", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(settings).toEqual({
        accountingCutoverDate: f.cutoverDate,
        accountingActivatedBy: USER
      });

      // A payment of the rest posts against the opening line, and the
      // receivable nets to zero.
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, { id: "pay-2", invoiceId, amount: 60 })
        })
      );
      expect(await glBalance(f, "receivables")).toBeCloseTo(0, 6);

      // The enable is one-way.
      const again = await activateAccounting(f.ctx, {
        ...args,
        confirmation: f.companyName
      });
      expect(again.error?.message).toBe("Accounting is already set up.");
    } finally {
      await f.cleanup();
    }
  }
);
