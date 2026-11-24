// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a pre-cutover purchase invoice to the GL. The invoice was posted
// before the cutover at no price, the enable superseded its journal and took
// no payable for it, and its price was entered after. The posting books what
// the invoice posting would book today and credits payables keyed to the
// invoice, so a payment then posts, and the inventory ledger moves with the GL.

import { saveOpeningTrialBalance } from "@carbon/database/accounting-cutover-reads";
import { GL_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import { sql } from "kysely";
import { describe, expect } from "vitest";
import { activateAccounting } from "../../../app/modules/accounting/accounting.service";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import {
  postPayment,
  postPurchaseInvoiceToLedger,
  previewPurchaseInvoiceLedgerPosting,
  purchaseInvoiceLedgerGap
} from "../../../app/modules/invoicing/invoicing.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import {
  type AccountName,
  activationFixture,
  type Fixture,
  glBalance,
  moveBeforeCutover,
  shipFiveParts,
  USER,
  unwrap
} from "../fixtures/activation";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";

/** A purchase order for `quantity` parts at `unitPrice`. */
async function orderParts(f: Fixture, quantity: number, unitPrice: number) {
  const purchaseOrderId = `${f.prefix}-po`;
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
        purchaseOrderId: "PO-1",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "To Receive and Invoice",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({ id: purchaseOrderId, locationId: f.locationId, companyId: f.companyId })
      .execute();
    return trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: quantity,
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
  return { purchaseOrderId, purchaseOrderLineId: line.id, quantity };
}

type Order = Awaited<ReturnType<typeof orderParts>>;

async function receive(f: Fixture, order: Order) {
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId: order.purchaseOrderId,
      locationId: f.locationId
    })
  );
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId: receipt.id },
      postReceipt
    )
  );
}

/** Invoices the ordered parts at no price, posted: what the enable reads of
 *  such an invoice (it supersedes the invoice's journal, so none is needed):
 *  an Open invoice with a posting date, and the PO line invoiced. */
async function invoiceAtNoPrice(f: Fixture, order: Order) {
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
        status: "Open",
        postingDate: f.today,
        dateIssued: f.today,
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
        purchaseOrderId: order.purchaseOrderId,
        purchaseOrderLineId: order.purchaseOrderLineId,
        quantity: order.quantity,
        supplierUnitPrice: 0,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("purchaseOrderLine")
      .set({ quantityInvoiced: order.quantity, invoicedComplete: true })
      .where("companyId", "=", f.companyId)
      .where("id", "=", order.purchaseOrderLineId)
      .execute();
  });
  return invoiceId;
}

/** Dates everything before the cutover and enables with `lines` as the
 *  prior system's trial balance. */
async function enable(
  f: Fixture,
  invoiceId: string,
  lines: { account: AccountName; debit: number; credit: number }[]
) {
  await moveBeforeCutover(f);
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("purchaseInvoice")
      .set({ postingDate: f.beforeCutover, dateIssued: f.beforeCutover })
      .where("companyId", "=", f.companyId)
      .where("id", "=", invoiceId)
      .execute();
  });
  await f.db
    .updateTable("accountDefault")
    .set({ scrapAccount: f.account("scrap") })
    .where("companyId", "=", f.companyId)
    .execute();
  const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
  await saveOpeningTrialBalance(f.db, {
    ...args,
    userId: USER,
    lines: lines.map(({ account, debit, credit }) => ({
      accountId: f.account(account),
      debit,
      credit
    }))
  });
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "activate-accounting",
      { ...args, confirmation: f.companyName },
      activateAccounting
    )
  );
}

/** The price entered on the posted invoice's line after the cutover, as the
 *  unguarded line update wrote it: no journal. */
async function priceAfterCutover(f: Fixture, invoiceId: string, unitPrice: number) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("purchaseInvoiceLine")
      .set({ supplierUnitPrice: unitPrice })
      .where("companyId", "=", f.companyId)
      .where("invoiceId", "=", invoiceId)
      .execute();
  });
}

function postToLedger(
  f: Fixture,
  invoiceId: string,
  postingDate = f.cutoverDate
) {
  return invokePosting(
    handlesOf(f.ctx),
    "post-purchase-invoice-to-ledger",
    { invoiceId, postingDate },
    postPurchaseInvoiceToLedger
  );
}

/** The posted journal's amounts by account (natural sign: credit + on a
 *  liability or equity account, debit + on an asset or expense). */
async function journalAmounts(f: Fixture, journalId: string) {
  const rows = await f.db
    .selectFrom("journalLine")
    .select(["accountId", sql<number>`sum("amount")`.as("amount")])
    .where("companyId", "=", f.companyId)
    .where("journalId", "=", journalId)
    .groupBy("accountId")
    .execute();
  return Object.fromEntries(
    rows.map((row) => [row.accountId, Math.round(Number(row.amount) * 100) / 100])
  );
}

/** The inventory ledger's value: open layers and their write-ups. */
async function inventoryLedgerValue(f: Fixture) {
  const row = await f.db
    .selectFrom("costLedger as layer")
    .leftJoin("costLedger as child", (join) =>
      join
        .onRef("child.appliesToCostLedgerId", "=", "layer.id")
        .onRef("child.companyId", "=", "layer.companyId")
    )
    .select(
      sql<number>`coalesce(sum(distinct "layer"."cost" * "layer"."remainingQuantity" / nullif("layer"."quantity", 0)), 0) + coalesce(sum("child"."cost" * "child"."remainingQuantity" / nullif("child"."quantity", 0)), 0)`.as(
        "value"
      )
    )
    .where("layer.companyId", "=", f.companyId)
    .where("layer.adjustment", "=", false)
    .where("layer.remainingQuantity", ">", 0)
    .executeTakeFirstOrThrow();
  return Math.round(Number(row.value) * 100) / 100;
}

async function purchaseVarianceAccount(f: Fixture) {
  const row = await f.db
    .selectFrom("accountDefault")
    .select("purchaseVarianceAccount")
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.purchaseVarianceAccount;
}

/** A supplier payment of `amount` applied to the invoice, posted. */
async function paySupplier(f: Fixture, invoiceId: string, amount: number) {
  const paymentId = `${f.prefix}-supplier-payment`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId: "PAY-1",
        paymentType: "Disbursement",
        supplierId: f.supplierId,
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
        targetPurchaseInvoiceId: invoiceId,
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
  return invokePosting(
    handlesOf(f.ctx),
    "post-payment",
    { type: "post", paymentId },
    postPayment
  );
}

describe("postPurchaseInvoiceToLedger", () => {
  databaseTest(
    "writes up the opening layer for the units on hand, sends the used units to PPV, and lets a payment post",
    async () => {
      const f = await activationFixture();
      try {
        // Before the cutover: 10 parts received and invoiced at no price.
        const order = await orderParts(f, 10, 0);
        await receive(f, order);
        const invoiceId = await invoiceAtNoPrice(f, order);
        await enable(f, invoiceId, []);
        // After it: 5 parts shipped, then the price (3) entered.
        await shipFiveParts(f);
        await priceAfterCutover(f, invoiceId, 3);

        // The gap the payment refuses on.
        expect((await paySupplier(f, invoiceId, 30)).error?.message).toMatch(
          /missing its original control account/
        );
        await f.db
          .deleteFrom("invoiceSettlement")
          .where("companyId", "=", f.companyId)
          .execute();
        await f.db.deleteFrom("payment").where("companyId", "=", f.companyId).execute();

        // A date before the cutover is refused.
        expect((await postToLedger(f, invoiceId, f.beforeCutover)).error?.message).toMatch(
          /on or after the accounting cutover/
        );

        const preview = unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "preview-purchase-invoice-ledger-posting",
            { invoiceId, postingDate: f.cutoverDate },
            previewPurchaseInvoiceLedgerPosting
          )
        );
        const posted = unwrap(await postToLedger(f, invoiceId));

        // 10 x 3 = 30 payable: the 5 on hand write up inventory (15), the 5
        // shipped are purchase variance (15). The receipt credited GR/IR
        // nothing, and the clearing line says so, as the invoice posting's.
        const ppv = await purchaseVarianceAccount(f);
        expect(await journalAmounts(f, posted.journalId)).toEqual({
          [f.account("grni")]: 0,
          [f.account("payables")]: 30,
          [f.account("inventory")]: 15,
          [ppv!]: 15
        });
        // The preview showed exactly what was posted.
        expect(
          preview.lines
            .map((line) => [line.accountId, line.debit, line.credit])
            .sort()
        ).toEqual(
          [
            [f.account("payables"), 0, 30],
            [f.account("inventory"), 15, 0],
            [ppv, 15, 0]
          ].sort()
        );
        expect(preview.hasOpeningValue).toBe(false);

        // The inventory ledger moved with the GL.
        expect(await inventoryLedgerValue(f)).toBe(
          Math.round((await glBalance(f, "inventory")) * 100) / 100
        );

        // Posted once: the invoice now has its payable, and a payment posts.
        expect(await purchaseInvoiceLedgerGap(f.db, f.companyId, invoiceId)).toEqual({
          eligible: false,
          reason: "The invoice's payable is already in the GL."
        });
        expect((await postToLedger(f, invoiceId)).error).not.toBeNull();
        expect((await paySupplier(f, invoiceId, 30)).error).toBeNull();
        expect(await glBalance(f, "payables")).toBeCloseTo(0, 6);
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest(
    "writes the price onto the layer of a receipt after the cutover at no cost",
    async () => {
      const f = await activationFixture();
      try {
        // Before the cutover: 5 parts ordered at 8, invoiced at no price.
        const order = await orderParts(f, 5, 8);
        const invoiceId = await invoiceAtNoPrice(f, order);
        await enable(f, invoiceId, []);
        // After it: the parts arrive, costed at the invoice's accrual (0),
        // and the price (10) is entered.
        await receive(f, order);
        await priceAfterCutover(f, invoiceId, 10);
        expect(await inventoryLedgerValue(f)).toBe(0);

        unwrap(await postToLedger(f, invoiceId));

        // GR/IR stays clear, and payables hold the 50 the supplier billed.
        expect(await glBalance(f, "grni")).toBeCloseTo(0, 6);
        expect(await glBalance(f, "payables")).toBeCloseTo(50, 6);
        // All 5 are on hand, so inventory carries the whole 50.
        expect(await glBalance(f, "inventory")).toBeCloseTo(50, 6);
        expect(await inventoryLedgerValue(f)).toBe(50);
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest(
    "clears the value the opening balance holds against Migration Clearing",
    async () => {
      const f = await activationFixture();
      try {
        // Before the cutover: 5 parts received at 8 (40), invoiced at no
        // price. The prior books hold the stock against equity.
        const order = await orderParts(f, 5, 8);
        await receive(f, order);
        const invoiceId = await invoiceAtNoPrice(f, order);
        await enable(f, invoiceId, [
          { account: "inventory", debit: 40, credit: 0 },
          { account: "retained-earnings", debit: 0, credit: 40 }
        ]);
        await priceAfterCutover(f, invoiceId, 9);

        const preview = unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "preview-purchase-invoice-ledger-posting",
            { invoiceId, postingDate: f.cutoverDate },
            previewPurchaseInvoiceLedgerPosting
          )
        );
        expect(preview.hasOpeningValue).toBe(true);
        const posted = unwrap(await postToLedger(f, invoiceId));

        // 45 payable: 40 was already in the opening inventory, so it debits
        // Migration Clearing; the other 5 write up the 5 parts on hand.
        expect(await journalAmounts(f, posted.journalId)).toEqual({
          [f.account("payables")]: 45,
          [f.account("migration-clearing")]: -40,
          [f.account("inventory")]: 5
        });
        expect(await inventoryLedgerValue(f)).toBe(45);
        expect(await glBalance(f, "inventory")).toBeCloseTo(45, 6);
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest("refuses an invoice posted on or after the cutover", async () => {
    const f = await activationFixture();
    try {
      const order = await orderParts(f, 5, 8);
      await enable(f, `${f.prefix}-none`, []);
      await receive(f, order);
      const invoiceId = await invoiceAtNoPrice(f, order);
      await priceAfterCutover(f, invoiceId, 9);

      expect(await purchaseInvoiceLedgerGap(f.db, f.companyId, invoiceId)).toEqual({
        eligible: false,
        reason: expect.stringMatching(/before the accounting cutover/)
      });
      expect((await postToLedger(f, invoiceId)).error).not.toBeNull();
      // Nothing was written.
      const journals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("description", "like", "%(posted after cutover)")
        .where("status", "in", [...GL_JOURNAL_STATUSES])
        .execute();
      expect(journals).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});
