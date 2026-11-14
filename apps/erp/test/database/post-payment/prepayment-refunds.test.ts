// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { toBaseAmount } from "@carbon/database/accounting-currency";
import { loadPurchaseInvoiceDocumentIds } from "@carbon/database/deposit-scope";
import { getCutoverOpenItems } from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  getAvailableOnAccountCreditSources,
  getDepositDocuments,
  postPaymentTransaction,
  replaceInvoiceSettlements,
  rebuildPaymentJournals
} from "../../../app/modules/invoicing/invoicing.service";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import { localApiKeyClient, postgrestTest } from "../fixtures/local-supabase";

async function prepaymentFixture() {
  const f = await paymentFixture();
  const supplier = await f.db
    .insertInto("supplier")
    .values({ name: "Prepayment supplier", companyId: f.companyId })
    .returning("id")
    .executeTakeFirstOrThrow();
  const interaction = await f.db
    .insertInto("supplierInteraction")
    .values({ supplierId: supplier.id, companyId: f.companyId })
    .returning("id")
    .executeTakeFirstOrThrow();
  const purchaseOrderId = crypto.randomUUID();
  await f.db
    .insertInto("purchaseOrder")
    .values({
      id: purchaseOrderId,
      purchaseOrderId: "PO-PREPAY",
      supplierId: supplier.id,
      supplierInteractionId: interaction.id,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      companyId: f.companyId,
      createdBy: "system",
      status: "To Receive and Invoice"
    })
    .execute();
  const originalAccount = f.account("prepayment");
  const changedAccount = f.account("new-prepayment");
  await f.db
    .insertInto("account")
    .values(
      [originalAccount, changedAccount].map((id) => ({
        id,
        name: id,
        class: "Asset" as const,
        incomeBalance: "Balance Sheet" as const,
        companyGroupId: f.groupId,
        createdBy: "system"
      }))
    )
    .execute();
  await f.db
    .updateTable("accountDefault")
    .set({ supplierPrepaymentAccount: originalAccount })
    .where("companyId", "=", f.companyId)
    .execute();
  const payment = async (amount: number, refund = false, rate = 1.1) => {
    const id = await f.payment({ amount, rate, noApplication: true });
    await f.db
      .updateTable("payment")
      .set({
        customerId: null,
        supplierId: supplier.id,
        purchaseOrderId,
        paymentType: refund ? "Receipt" : "Disbursement"
      })
      .where("id", "=", id)
      .where("companyId", "=", f.companyId)
      .execute();
    return id;
  };
  const post = (paymentId: string, type: "post" | "void" = "post") =>
    postPaymentTransaction(f.db, { ...f.args, paymentId, type });
  const lines = (journalId: string) =>
    f.db
      .selectFrom("journalLine")
      .select(["accountId", "amount"])
      .where("journalId", "=", journalId)
      .where("companyId", "=", f.companyId)
      .orderBy("accountId")
      .execute();
  return {
    ...f,
    supplierId: supplier.id,
    interactionId: interaction.id,
    purchaseOrderId,
    originalAccount,
    changedAccount,
    payment,
    post,
    lines
  };
}

databaseTest(
  "a supplier prepayment refund releases original carrying value and account, rejects excess, and restores principal when voided",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      await f.db
        .updateTable("accountDefault")
        .set({ supplierPrepaymentAccount: f.changedAccount })
        .where("companyId", "=", f.companyId)
        .execute();
      const refund = await f.payment(55, true, 1.25);
      const posted = await f.post(refund);
      expect(await f.lines(posted.journalId!)).toEqual([
        { accountId: f.account("bank"), amount: 44 },
        { accountId: f.account("loss"), amount: 6 },
        { accountId: f.originalAccount, amount: -50 }
      ]);
      const settlement = await f.db
        .selectFrom("invoiceSettlement")
        .select([
          "sourcePaymentId",
          "targetPaymentId",
          "sourceAmount",
          "appliedAmount",
          "fxGainLossAmount"
        ])
        .where("paymentId", "=", refund)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(settlement).toEqual({
        sourcePaymentId: source,
        targetPaymentId: source,
        sourceAmount: 55,
        appliedAmount: 50,
        fxGainLossAmount: 0
      });
      const openingItems = await getCutoverOpenItems(f.db, {
        companyId: f.companyId,
        cutoverDate: "2026-09-08"
      });
      expect(
        openingItems
          .filter((item) => item.documentId === source)
          .map((item) => ({ accountId: item.accountId, amount: item.amount }))
      ).toEqual([{ accountId: f.originalAccount, amount: 50 }]);
      expect(openingItems.filter((item) => item.documentId === refund)).toEqual(
        []
      );
      const rollback = new Error("restore refund journal");
      await expect(
        f.db.transaction().execute(async (trx) => {
          await sql`SET LOCAL session_replication_role = replica`.execute(trx);
          await trx
            .deleteFrom("journalLine")
            .where("journalId", "=", posted.journalId!)
            .where("companyId", "=", f.companyId)
            .execute();
          await sql`SET LOCAL session_replication_role = origin`.execute(trx);
          const legacyItems = await getCutoverOpenItems(trx, {
            companyId: f.companyId,
            cutoverDate: "2026-09-08"
          });
          expect(
            legacyItems
              .filter((item) => item.documentId === source)
              .map((item) => ({
                accountId: item.accountId,
                amount: item.amount
              }))
          ).toEqual([{ accountId: f.originalAccount, amount: 50 }]);
          expect(
            legacyItems.filter((item) => item.documentId === refund)
          ).toEqual([]);
          throw rollback;
        })
      ).rejects.toBe(rollback);
      await expect(f.post(source, "void")).rejects.toThrow();
      const excess = await f.payment(55.01, true);
      await expect(f.post(excess)).rejects.toThrow();
      const last = await f.payment(55, true);
      await f.post(last);
      const empty = await f.payment(0.01, true);
      await expect(f.post(empty)).rejects.toThrow();
      await f.post(last, "void");
      await f.post(refund, "void");
      const restored = await f.payment(110, true);
      await f.post(restored);
      await f.post(restored, "void");
      await f.post(source, "void");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an invoice cannot spend principal already returned by a supplier prepayment refund",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const refund = await f.payment(55, true);
      await f.post(refund);
      const invoiceId = await supplierInvoice(f);
      const pay = await f.payment(0);
      await f.db
        .insertInto("invoiceSettlement")
        .values({
          paymentId: pay,
          targetPurchaseInvoiceId: invoiceId,
          sourcePaymentId: source,
          sourceAmount: 110,
          appliedAmount: 100,
          sourceExchangeRate: 1.1,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await expect(f.post(pay)).rejects.toThrow();
      await f.post(refund, "void");
      const postedInvoicePayment = await f.post(pay);
      expect(await f.lines(postedInvoicePayment.journalId!)).toEqual([
        { accountId: f.account("employee-payable"), amount: -100 },
        { accountId: f.originalAccount, amount: -100 }
      ]);
      expect(
        await f.db
          .selectFrom("invoiceSettlement")
          .select(["sourcePaymentId", "sourceAmount", "appliedAmount"])
          .where("paymentId", "=", pay)
          .where("companyId", "=", f.companyId)
          .execute()
      ).toEqual([
        { sourcePaymentId: source, sourceAmount: 110, appliedAmount: 100 }
      ]);
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("payment")
            .set({ status: "Voided" })
            .where("id", "=", source)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/posted payments consume/i);
      await f.post(pay, "void");
      await f.post(source, "void");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a fully refunded prepayment rebuilds from its original deposit account after cutover supersedes its journal",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      const original = await f.post(source);
      const refund = await f.payment(110, true, 1.25);
      const posted = await f.post(refund);
      const expected = await f.lines(posted.journalId!);
      await f.db
        .updateTable("accountDefault")
        .set({ supplierPrepaymentAccount: f.changedAccount })
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Superseded" })
          .where("id", "in", [original.journalId!, posted.journalId!])
          .where("companyId", "=", f.companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        const payment = await trx
          .selectFrom("payment")
          .selectAll()
          .where("id", "=", refund)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        const [rebuilt] = await rebuildPaymentJournals(
          trx,
          [payment],
          f.companyId,
          { postingStatus: "Posted", feeByPaymentId: new Map() }
        );
        expect(
          rebuilt!.lines
            .map(({ accountId, amount }) => ({ accountId, amount }))
            .sort((a, b) => a.accountId.localeCompare(b.accountId))
        ).toEqual(expected);
      });
    } finally {
      await f.cleanup();
    }
  }
);

type PrepaymentFixture = Awaited<ReturnType<typeof prepaymentFixture>>;

async function supplierInvoice(f: PrepaymentFixture) {
  const invoiceId = crypto.randomUUID();
  await f.db
    .insertInto("purchaseInvoice")
    .values({
      id: invoiceId,
      invoiceId,
      supplierId: f.supplierId,
      supplierInteractionId: f.interactionId,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      status: "Open",
      companyId: f.companyId,
      createdBy: "system"
    })
    .execute();
  const orderLine = await f.db
    .insertInto("purchaseOrderLine")
    .values({
      purchaseOrderId: f.purchaseOrderId,
      purchaseOrderLineType: "G/L Account",
      accountId: f.account("loss"),
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("purchaseInvoiceLine")
    .values({
      invoiceId,
      invoiceLineType: "G/L Account",
      quantity: 1,
      supplierUnitPrice: 110,
      exchangeRate: 1.1,
      accountId: f.account("loss"),
      purchaseOrderLineId: orderLine.id,
      companyId: f.companyId,
      createdBy: "system"
    })
    .execute();
  expect(
    await loadPurchaseInvoiceDocumentIds(f.db, f.companyId, [invoiceId])
  ).toEqual(new Map([[invoiceId, { purchaseOrderIds: [f.purchaseOrderId] }]]));
  const period = await f.db
    .selectFrom("accountingPeriod")
    .select("id")
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const journal = await f.db
    .insertInto("journal")
    .values({
      journalEntryId: invoiceId,
      accountingPeriodId: period.id,
      companyId: f.companyId,
      sourceType: "Purchase Invoice",
      status: "Posted",
      postingDate: "2026-09-07",
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("journalLine")
    .values(
      [
        {
          accountId: f.account("employee-payable"),
          description: "Accounts Payable"
        },
        { accountId: f.account("loss"), description: "Invoice offset" }
      ].map((line) => ({
        ...line,
        amount: 100,
        quantity: 1,
        journalId: journal.id,
        documentId: invoiceId,
        documentType: "Invoice" as const,
        journalLineReference: invoiceId,
        companyId: f.companyId
      }))
    )
    .execute();
  return invoiceId;
}

async function refundApplication(
  f: PrepaymentFixture,
  paymentId: string,
  sourceId: string,
  overrides = {}
) {
  return f.db
    .insertInto("invoiceSettlement")
    .values({
      paymentId,
      targetPaymentId: sourceId,
      sourcePaymentId: sourceId,
      sourceAmount: 110,
      appliedAmount: 100,
      sourceExchangeRate: 1.1,
      targetExchangeRate: 1.1,
      appliedDate: "2026-09-07",
      companyId: f.companyId,
      createdBy: "system",
      ...overrides
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

async function guarded<T>(
  f: Pick<PrepaymentFixture, "db">,
  run: (db: typeof f.db) => Promise<T>
) {
  return f.db.transaction().execute(async (db) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'false'`.execute(db);
    return run(db);
  });
}

databaseTest(
  "saved prepayments refuse a changed supplier atomically and can be retried",
  async () => {
    const f = await prepaymentFixture();
    try {
      const paymentId = await f.payment(110);
      const replacement = await f.db
        .insertInto("supplier")
        .values({
          name: "Replacement supplier",
          readableId: "SUP-REPLACEMENT",
          companyId: f.companyId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .updateTable("purchaseOrder")
        .set({ supplierId: replacement.id })
        .where("id", "=", f.purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(f.post(paymentId)).rejects.toThrow(/supplier/i);
      expect(
        await f.db
          .selectFrom("payment")
          .select(["status", "journalId"])
          .where("id", "=", paymentId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", journalId: null });
      expect(
        await f.db
          .selectFrom("invoiceSettlement")
          .select("id")
          .where("paymentId", "=", paymentId)
          .where("companyId", "=", f.companyId)
          .execute()
      ).toEqual([]);
      await f.db
        .updateTable("purchaseOrder")
        .set({ supplierId: f.supplierId })
        .where("id", "=", f.purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.post(paymentId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "independent simultaneous refunds cannot return the same advance twice",
  async () => {
    const f = await prepaymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const refunds = await Promise.all([
        f.payment(110, true),
        f.payment(110, true)
      ]);
      const results = await Promise.allSettled([
        postPaymentTransaction(left, { ...f.args, paymentId: refunds[0]! }),
        postPaymentTransaction(right, { ...f.args, paymentId: refunds[1]! })
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status !== "rejected")
        throw new Error("Expected exhausted advance refusal");
      expect(String(failed.reason)).toMatch(/refund|remaining|exceed/i);
      const states = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "in", refunds)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        states.filter((row) => row.status === "Draft" && row.journalId === null)
      ).toHaveLength(1);
      expect(
        states.filter(
          (row) => row.status === "Posted" && row.journalId !== null
        )
      ).toHaveLength(1);
      expect(
        await f.db
          .selectFrom("invoiceSettlement")
          .select(["sourceAmount", "appliedAmount"])
          .where("companyId", "=", f.companyId)
          .where("targetPaymentId", "=", source)
          .execute()
      ).toEqual([{ sourceAmount: 110, appliedAmount: 100 }]);
      const winner = results.findIndex(
        (result) => result.status === "fulfilled"
      );
      await f.post(refunds[winner]!, "void");
      await f.post(refunds[1 - winner]!);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "posted purchase order advances keep their company, supplier and order scope",
  async () => {
    const f = await prepaymentFixture();
    const other = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      await expect(
        f.db
          .updateTable("payment")
          .set({ purchaseOrderId: other.purchaseOrderId })
          .where("id", "=", source)
          .where("companyId", "=", f.companyId)
          .execute()
      ).rejects.toThrow();
      await expect(
        guarded(f, (db) =>
          db
            .deleteFrom("purchaseOrder")
            .where("id", "=", f.purchaseOrderId)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/posted prepayments/i);
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("purchaseOrder")
            .set({ supplierId: other.supplierId })
            .where("id", "=", f.purchaseOrderId)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/posted prepayments/i);
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("payment")
            .set({ status: "Draft" })
            .where("id", "=", source)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow();
      expect(
        await f.db
          .selectFrom("payment")
          .select(["purchaseOrderId", "status"])
          .where("id", "=", source)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ purchaseOrderId: f.purchaseOrderId, status: "Posted" });
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  }
);

databaseTest(
  "direct refunds must match their original advance and fully allocate before posting",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const refund = await f.payment(110, true);
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("payment")
            .set({ status: "Posted" })
            .where("id", "=", refund)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/allocate/i);
      const row = await refundApplication(f, refund, source);
      for (const patch of [
        { currencyCode: "USD" },
        { purchaseOrderId: null },
        {
          supplierId: null,
          customerId: f.customerId,
          paymentType: "Disbursement" as const
        }
      ]) {
        await expect(
          guarded(f, (db) =>
            db
              .updateTable("payment")
              .set({ ...patch, status: "Posted" })
              .where("id", "=", refund)
              .where("companyId", "=", f.companyId)
              .execute()
          )
        ).rejects.toThrow();
      }
      for (const patch of [
        { sourceAmount: 110.001 },
        { appliedAmount: 101 },
        { appliedAmount: 99 }
      ]) {
        await expect(
          guarded(f, async (db) => {
            await db
              .updateTable("invoiceSettlement")
              .set(patch)
              .where("id", "=", row.id)
              .where("companyId", "=", f.companyId)
              .execute();
            await db
              .updateTable("payment")
              .set({ status: "Posted" })
              .where("id", "=", refund)
              .where("companyId", "=", f.companyId)
              .execute();
          })
        ).rejects.toThrow();
      }
      expect(
        await f.db
          .selectFrom("payment")
          .select(["status", "journalId"])
          .where("id", "=", refund)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", journalId: null });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "directly posted refunds serialize on their advance and cannot consume it twice",
  async () => {
    const f = await prepaymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const refunds = await Promise.all([
        f.payment(110, true),
        f.payment(110, true)
      ]);
      await refundApplication(f, refunds[0]!, source);
      await refundApplication(f, refunds[1]!, source);
      const post = (db: typeof left, id: string) =>
        db.transaction().execute(async (trx) => {
          await sql`SET LOCAL "app.sync_in_progress" = 'false'`.execute(trx);
          return trx
            .updateTable("payment")
            .set({ status: "Posted" })
            .where("id", "=", id)
            .where("companyId", "=", f.companyId)
            .execute();
        });
      const results = await Promise.allSettled([
        post(left, refunds[0]!),
        post(right, refunds[1]!)
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
      const winner = results.findIndex(
        (result) => result.status === "fulfilled"
      );
      await expect(
        guarded(f, (db) =>
          db
            .deleteFrom("invoiceSettlement")
            .where("paymentId", "=", refunds[winner]!)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/cannot be changed/i);
      await expect(
        guarded(f, (db) =>
          db
            .insertInto("invoiceSettlement")
            .values({
              paymentId: refunds[winner]!,
              targetPaymentId: source,
              sourcePaymentId: source,
              sourceAmount: 1,
              appliedAmount: 0.90909,
              sourceExchangeRate: 1.1,
              targetExchangeRate: 1.1,
              companyId: f.companyId,
              appliedDate: "2026-09-07",
              createdBy: "system"
            })
            .execute()
        )
      ).rejects.toThrow(/cannot be changed/i);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "an ineffective draft refund does not prevent its source from being voided",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const refund = await f.payment(110, true);
      await refundApplication(f, refund, source);
      await guarded(f, (db) =>
        db
          .updateTable("payment")
          .set({ status: "Voided" })
          .where("id", "=", source)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("payment")
            .set({ status: "Posted" })
            .where("id", "=", refund)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow();
      expect(
        await f.db
          .selectFrom("payment")
          .select(["status", "journalId"])
          .where("id", "=", refund)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", journalId: null });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a refund and an invoice posting cannot spend the same supplier advance concurrently",
  async () => {
    const f = await prepaymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const invoiceId = await supplierInvoice(f);
      const invoicePayment = await f.payment(0);
      await f.db
        .insertInto("invoiceSettlement")
        .values({
          paymentId: invoicePayment,
          targetPurchaseInvoiceId: invoiceId,
          sourcePaymentId: source,
          sourceAmount: 110,
          appliedAmount: 100,
          sourceExchangeRate: 1.1,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      const refund = await f.payment(110, true);
      const payments = [invoicePayment, refund];
      const results = await Promise.allSettled([
        postPaymentTransaction(left, { ...f.args, paymentId: invoicePayment }),
        postPaymentTransaction(right, { ...f.args, paymentId: refund })
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status !== "rejected")
        throw new Error("Expected exhausted advance refusal");
      expect(String(failed.reason)).toMatch(/fund|exceed|remaining/i);
      const winner = results.findIndex(
        (result) => result.status === "fulfilled"
      );
      const loser = 1 - winner;
      expect(
        await f.db
          .selectFrom("payment")
          .select(["status", "journalId"])
          .where("id", "=", payments[loser]!)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", journalId: null });
      expect(
        await f.db
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Payment")
          .execute()
      ).toHaveLength(2);
      await f.post(payments[winner]!, "void");
      const retried = await f.post(payments[loser]!);
      expect(retried.journalId).not.toBeNull();
      expect(
        await f.db
          .selectFrom("payment")
          .select("status")
          .where("id", "=", payments[loser]!)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Posted" });
      await f.post(payments[loser]!, "void");
      await f.post(source, "void");
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "draft applications cannot be reparented into posted refunds",
  async () => {
    const f = await prepaymentFixture();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const postedRefund = await f.payment(55, true);
      await f.post(postedRefund);
      const draft = await f.payment(55, true);
      const application = await refundApplication(f, draft, source, {
        sourceAmount: 55,
        appliedAmount: 50
      });
      await expect(
        guarded(f, (db) =>
          db
            .updateTable("invoiceSettlement")
            .set({ paymentId: postedRefund })
            .where("id", "=", application.id)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/cannot be changed/i);
      expect(
        await f.db
          .selectFrom("invoiceSettlement")
          .select("paymentId")
          .where("id", "=", application.id)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ paymentId: draft });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding a funded payment does not acquire its prior advance lock late",
  async () => {
    const f = await prepaymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const source = await f.payment(110);
      await f.post(source);
      const invoiceId = await supplierInvoice(f);
      const funded = await f.payment(0);
      await f.db
        .insertInto("invoiceSettlement")
        .values({
          paymentId: funded,
          targetPurchaseInvoiceId: invoiceId,
          sourcePaymentId: source,
          sourceAmount: 110,
          appliedAmount: 100,
          sourceExchangeRate: 1.1,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.post(funded);
      await sql`SET lock_timeout='500ms'`.execute(right);
      await left.transaction().execute(async (trx) => {
        await trx
          .selectFrom("payment")
          .select("id")
          .where("id", "=", source)
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .execute();
        await postPaymentTransaction(right, {
          ...f.args,
          paymentId: funded,
          type: "void"
        });
      });
      expect(
        await f.db
          .selectFrom("payment")
          .select("status")
          .where("id", "=", funded)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Voided" });
      await f.post(source, "void");
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "deleting an order with a busy draft payment refuses promptly and can be retried",
  async () => {
    const f = await prepaymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const draft = await f.payment(110);
      await sql`SET lock_timeout='500ms'`.execute(right);
      await left.transaction().execute(async (trx) => {
        await trx
          .selectFrom("payment")
          .select("id")
          .where("id", "=", draft)
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .execute();
        await expect(
          right.transaction().execute(async (tx) => {
            await sql`SET LOCAL "app.sync_in_progress"='false'`.execute(tx);
            await tx
              .deleteFrom("purchaseOrder")
              .where("id", "=", f.purchaseOrderId)
              .where("companyId", "=", f.companyId)
              .execute();
          })
        ).rejects.toThrow(/could not obtain lock/i);
      });
      await guarded(f, (db) =>
        db
          .deleteFrom("purchaseOrder")
          .where("id", "=", f.purchaseOrderId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      expect(
        await f.db
          .selectFrom("payment")
          .select(["status", "purchaseOrderId"])
          .where("id", "=", draft)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", purchaseOrderId: null });
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);


async function customerDepositFixture() {
  const f = await paymentFixture();
  const order = await f.db.insertInto("salesOrder").values({
    salesOrderId: "SO-LEGACY-REFUND", customerId: f.customerId,
    companyId: f.companyId, createdBy: "system", currencyCode: "EUR", exchangeRate: 1.1
  }).returning("id").executeTakeFirstOrThrow();
  const depositAccount = f.account("customer-deposit");
  await f.db.insertInto("account").values({id: depositAccount, name: "Customer deposits",
    class: "Liability", incomeBalance: "Balance Sheet", companyGroupId: f.groupId, createdBy: "system"}).execute();
  await f.db.updateTable("accountDefault").set({prepaymentAccount: depositAccount}).where("companyId", "=", f.companyId).execute();
  const payment = async (amount: number, refund = false, rate = 1.1) => {
    const id = await f.payment({amount, rate, noApplication: true});
    await f.db.updateTable("payment").set({salesOrderId: order.id, paymentType: refund ? "Disbursement" : "Receipt"}).where("id", "=", id).where("companyId", "=", f.companyId).execute();
    return id;
  };
  const post = (paymentId: string, type: "post" | "void" = "post") => postPaymentTransaction(f.db, {...f.args, paymentId, type});
  const historicalRefund = async (amount: number, rate = 1.1) => {
    const id = await payment(amount, true, rate);
    await f.db.transaction().execute(async trx => {
      // Before advance-consumption applications existed, posting wrote only these journal lines.
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      const journal = await trx.insertInto("journal").values({journalEntryId: id,
        companyId: f.companyId, sourceType: "Payment", status: "Posted", postingDate: "2026-09-07", createdBy: "system"}).returning("id").executeTakeFirstOrThrow();
      await trx.insertInto("journalLine").values([
        {accountId: f.account("bank"), amount: -toBaseAmount(amount, rate), description: "Bank / Cash"},
        {accountId: depositAccount, amount: -toBaseAmount(amount, rate), description: "Customer Deposit"}
      ].map(line => ({...line, journalId: journal.id, companyId: f.companyId,
        documentType: "Payment" as const, documentId: id, quantity: 1, journalLineReference: id}))).execute();
      await trx.updateTable("payment").set({status: "Posted", journalId: journal.id, postingDate: "2026-09-07"})
        .where("id", "=", id).where("companyId", "=", f.companyId).execute();
    });
    return id;
  };
  return {...f, orderId: order.id, depositAccount, payment, post, historicalRefund};
}

databaseTest("historical customer refunds reserve their original advance before another refund posts", async () => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110);
    await f.post(advance);
    await f.historicalRefund(44);
    const excess = await f.payment(66.01, true);
    await expect(f.post(excess)).rejects.toThrow(/remaining|historical/i);
    const remainder = await f.payment(66, true);
    await f.post(remainder);
    const empty = await f.payment(0.01, true);
    await expect(f.post(empty)).rejects.toThrow(/remaining|historical/i);
  } finally { await f.cleanup(); }
});

postgrestTest("customer funding availability subtracts historical deposit refunds", async client => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110);
    await f.post(advance);
    await f.historicalRefund(44);
    const available = await getAvailableOnAccountCreditSources(client, f.companyId,
      {paymentType: "Receipt", customerId: f.customerId}, "EUR");
    expect(available.error).toBeNull();
    expect(available.data?.sources.map(source => ({amount: source.remainingDocument, base: source.remainingBase})))
      .toEqual([{amount: 66, base: 60}]);
  } finally { await f.cleanup(); }
});

postgrestTest("the refund picker excludes prepayments fully spent by their own cash applications", async client => {
  const f = await prepaymentFixture();
  try {
    const invoiceId = await supplierInvoice(f);
    const payment = await f.payment(110);
    await f.db.insertInto("invoiceSettlement").values({paymentId: payment,
      targetPurchaseInvoiceId: invoiceId, sourceAmount: 110, appliedAmount: 100,
      sourceExchangeRate: 1.1, targetExchangeRate: 1.1, companyId: f.companyId,
      createdBy: "system", appliedDate: "2026-09-07"}).execute();
    await f.post(payment);
    const docs = await getDepositDocuments(client, f.companyId);
    expect(docs.find(doc => doc.id === f.purchaseOrderId)?.refundableCurrencyCodes).toEqual([]);
  } finally { await f.cleanup(); }
});


databaseTest("historically refunded advances cannot be voided until the historical refund is voided", async () => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance);
    const legacy = await f.historicalRefund(44);
    await expect(guarded(f, db => db.updateTable("payment").set({status: "Voided"}).where("id", "=", advance).where("companyId", "=", f.companyId).execute())).rejects.toThrow(/historical|refund/i);
    await expect(f.post(advance, "void")).rejects.toThrow(/historical|refund/i);
    await f.post(legacy, "void");
    await f.post(advance, "void");
  } finally { await f.cleanup(); }
});

databaseTest("direct refund posting cannot spend cash already returned by a historical refund", async () => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance);
    await f.historicalRefund(44);
    const refund = await f.payment(110, true);
    await guarded(f, db => db.insertInto("invoiceSettlement").values({paymentId: refund,
      targetPaymentId: advance, sourcePaymentId: advance, sourceAmount: 110,
      appliedAmount: 100, sourceExchangeRate: 1.1, targetExchangeRate: 1.1,
      appliedDate: "2026-09-07", companyId: f.companyId, createdBy: "system"}).execute());
    await expect(guarded(f, db => db.updateTable("payment").set({status: "Posted"})
      .where("id", "=", refund).where("companyId", "=", f.companyId).execute()))
      .rejects.toThrow(/historical|remaining/i);
  } finally { await f.cleanup(); }
});


postgrestTest("fully refunded historical deposits have no remaining funding and cutover keeps their net journal balance", async client => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance);
    await f.historicalRefund(110);
    const available = await getAvailableOnAccountCreditSources(client, f.companyId, {paymentType: "Receipt", customerId: f.customerId}, "EUR");
    expect(available.error).toBeNull(); expect(available.data?.sources).toEqual([]);
    await expect(f.post(await f.payment(0.01, true))).rejects.toThrow(/remaining|historical/i);
    const items = await getCutoverOpenItems(f.db, {companyId: f.companyId, cutoverDate: "2026-09-08"});
    expect(items.filter(item => item.accountId === f.depositAccount).reduce((sum, item) => sum + item.amount, 0)).toBe(0);
  } finally { await f.cleanup(); }
});

postgrestTest("multiple historical advances coexist with modern refunds and voids", async client => {
  const f = await customerDepositFixture();
  try {
    await f.post(await f.payment(55)); await f.post(await f.payment(110));
    const legacy = await f.historicalRefund(132);
    const modern = await f.payment(33, true); await f.post(modern);
    const available = () => getAvailableOnAccountCreditSources(client, f.companyId, {paymentType: "Receipt", customerId: f.customerId}, "EUR");
    expect((await available()).data?.sources).toEqual([]);
    await f.post(modern, "void");
    expect((await available()).data?.sources.reduce((sum, source) => sum + source.remainingDocument, 0)).toBe(33);
    await f.post(legacy, "void");
    expect((await available()).data?.sources.reduce((sum, source) => sum + source.remainingDocument, 0)).toBe(165);
    await f.post(await f.payment(165, true));
  } finally { await f.cleanup(); }
});

postgrestTest("incompatible historical carrying values require reconciliation without changing their journal", async client => {
  const f = await customerDepositFixture();
  try {
    await f.post(await f.payment(110));
    const legacy = await f.historicalRefund(44, 1.25);
    const before = await f.db.selectFrom("journalLine").select(["accountId", "amount"]).where("documentId", "=", legacy).where("companyId", "=", f.companyId).orderBy("accountId").execute();
    await expect(f.post(await f.payment(66, true))).rejects.toThrow(/Reconcile historical deposit refund/);
    expect((await getAvailableOnAccountCreditSources(client, f.companyId, {paymentType: "Receipt", customerId: f.customerId}, "EUR")).error?.message).toMatch(/Reconcile historical deposit refund/);
    expect(await f.db.selectFrom("journalLine").select(["accountId", "amount"]).where("documentId", "=", legacy).where("companyId", "=", f.companyId).orderBy("accountId").execute()).toEqual(before);
    const items = await getCutoverOpenItems(f.db, {companyId: f.companyId, cutoverDate: "2026-09-08"});
    expect(items.filter(item => item.accountId === f.depositAccount).reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(64.8, 6);
  } finally { await f.cleanup(); }
});

databaseTest("invoice application editing and posting cannot reuse historically refunded principal", async () => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance); await f.historicalRefund(44);
    await f.db.updateTable("salesInvoiceLine").set({salesOrderId: f.orderId}).where("invoiceId", "=", f.invoiceId).where("companyId", "=", f.companyId).execute();
    const paymentId = await f.payment(0);
    const application = {targetSalesInvoiceId: f.invoiceId, appliedAmount:100, discountAmount:0, writeOffAmount:0,
      sourceAmount:110, sourcePaymentId:advance, sourceExchangeRate:1.1,targetExchangeRate:1.1,appliedDate:"2026-09-07"};
    const {sourcePaymentId: _source, ...request} = application;
    await expect(replaceInvoiceSettlements(f.db, {paymentId,companyId:f.companyId,createdBy:"system",applications:[request]})).rejects.toThrow(/remaining|funding|cash|principal|historical/i);
    await f.db.insertInto("invoiceSettlement").values({...application,paymentId,companyId:f.companyId,createdBy:"system"}).execute();
    await expect(f.post(paymentId)).rejects.toThrow();
    await f.db.deleteFrom("invoiceSettlement").where("paymentId","=",paymentId).where("companyId","=",f.companyId).execute();
    await replaceInvoiceSettlements(f.db, {paymentId,companyId:f.companyId,createdBy:"system",applications:[{...request,sourceAmount:66,appliedAmount:60}]});
    await f.post(paymentId);
  } finally { await f.cleanup(); }
});


databaseTest("direct historical refund guards preserve each original deposit account", async () => {
  const f = await customerDepositFixture();
  try {
    const a = await f.payment(110); await f.post(a);
    await f.db.insertInto("account").values({id:f.account("second-deposit"),name:"Second deposits",class:"Liability",incomeBalance:"Balance Sheet",companyGroupId:f.groupId,createdBy:"system"}).execute();
    await f.db.updateTable("accountDefault").set({prepaymentAccount:f.account("second-deposit")}).where("companyId","=",f.companyId).execute();
    await f.post(await f.payment(110)); await f.historicalRefund(110);
    const refund = await f.payment(110, true);
    await guarded(f, db => db.insertInto("invoiceSettlement").values({paymentId:refund,targetPaymentId:a,sourcePaymentId:a,sourceAmount:110,appliedAmount:100,sourceExchangeRate:1.1,targetExchangeRate:1.1,appliedDate:"2026-09-07",companyId:f.companyId,createdBy:"system"}).execute());
    await expect(guarded(f, db=>db.updateTable("payment").set({status:"Posted"}).where("id","=",refund).where("companyId","=",f.companyId).execute())).rejects.toThrow(/historical|remaining|reconcile/i);
  }finally{await f.cleanup();}
});

databaseTest("direct historical refund guards reject ambiguous mixed-rate source reuse", async () => {
  const f = await customerDepositFixture();
  try {
    const a = await f.payment(100, false, 1); await f.post(a);
    await f.post(await f.payment(100, false, 2)); await f.historicalRefund(100, 1);
    const refund = await f.payment(50, true, 1);
    await expect(guarded(f, async db => {
      await db.insertInto("invoiceSettlement").values({paymentId:refund,targetPaymentId:a,sourcePaymentId:a,sourceAmount:50,appliedAmount:50,sourceExchangeRate:1,targetExchangeRate:1,appliedDate:"2026-09-07",companyId:f.companyId,createdBy:"system"}).execute();
      await db.updateTable("payment").set({status:"Posted"}).where("id","=",refund).where("companyId","=",f.companyId).execute();
    })).rejects.toThrow(/historical|remaining|reconcile/i);
  }finally{await f.cleanup();}
});


postgrestTest("invoicing-only callers can calculate historical funding without journal access", async trusted => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance); await f.historicalRefund(44);
    const rawKey = `crbn_review_${crypto.randomUUID()}`;
    await f.db.insertInto("apiKey").values({name:"Invoicing only",companyId:f.companyId,createdBy:"system",
      keyHash:createHash("sha256").update(rawKey).digest("hex"),scopes:JSON.stringify({invoicing_view:[f.companyId]})}).execute();
    const caller = localApiKeyClient(rawKey)!;
    expect(caller).not.toBeNull();
    const visible = await caller.from("payment").select("id").eq("companyId",f.companyId).eq("id",advance);
    expect(visible.error).toBeNull(); expect(visible.data).toHaveLength(1);
    const hidden = await caller.from("journalLine").select("id").eq("companyId",f.companyId);
    expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
    const available = await getAvailableOnAccountCreditSources(caller,f.companyId,{paymentType:"Receipt",customerId:f.customerId},"EUR",trusted);
    expect(available.error).toBeNull();
    expect(available.data?.sources.map(source=>({amount:source.remainingDocument,base:source.remainingBase}))).toEqual([{amount:66,base:60}]);
  }finally{await f.cleanup();}
});

databaseTest("voiding a historical refund does not lock a sibling draft deposit", async () => {
  const f = await customerDepositFixture();
  const second = await f.connect();
  try {
    const advance = await f.payment(110); await f.post(advance);
    const legacy = await f.historicalRefund(44);
    const draft = await f.payment(55);
    let ready = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {release = resolve;});
    const arrived = async () => {if (++ready === 2) release(); await barrier;};
    const results = await Promise.allSettled([
      f.db.transaction().execute(async trx => {
        await sql`SET LOCAL "app.sync_in_progress" = 'false'`.execute(trx);
        await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);
        await trx.selectFrom("payment").select("id").where("companyId","=",f.companyId).where("id","in",[advance,legacy]).orderBy("id").forUpdate().execute();
        await arrived();
        await trx.updateTable("payment").set({status:"Voided"}).where("companyId","=",f.companyId).where("id","=",legacy).execute();
      }),
      second.transaction().execute(async trx => {
        await sql`SET LOCAL "app.sync_in_progress" = 'false'`.execute(trx);
        await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);
        await trx.selectFrom("payment").select("id").where("companyId","=",f.companyId).where("id","=",draft).forUpdate().execute();
        await arrived();
        await trx.updateTable("payment").set({status:"Posted"}).where("companyId","=",f.companyId).where("id","=",draft).execute();
      })
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled","fulfilled"]);
  } finally {await second.destroy(); await f.cleanup();}
});

postgrestTest("a historical refund fully used for a memo does not reserve a deposit", async client => {
  const f = await customerDepositFixture();
  try {
    const advance = await f.payment(110); await f.post(advance);
    const refund = await f.historicalRefund(44);
    await f.db.transaction().execute(async trx => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      const memo = await trx.insertInto("memo").values({memoId:crypto.randomUUID(),companyId:f.companyId,
        customerId:f.customerId,direction:"Credit",memoDate:"2026-09-07",currencyCode:"EUR",exchangeRate:1.1,amount:44,status:"Posted",createdBy:"system"}).returning("id").executeTakeFirstOrThrow();
      await trx.updateTable("journalLine").set({accountId:f.account("control"),amount:40,description:"Accounts Receivable"})
        .where("companyId","=",f.companyId).where("documentId","=",refund).where("description","=","Customer Deposit").execute();
      await trx.insertInto("invoiceSettlement").values({paymentId:refund,targetMemoId:memo.id,sourceAmount:44,appliedAmount:40,
        sourceExchangeRate:1.1,targetExchangeRate:1.1,appliedDate:"2026-09-07",companyId:f.companyId,createdBy:"system"}).execute();
    });
    const available = await getAvailableOnAccountCreditSources(client,f.companyId,{paymentType:"Receipt",customerId:f.customerId},"EUR");
    expect(available.error).toBeNull(); expect(available.data?.sources[0]?.remainingDocument).toBe(110);
    const rollback = new Error("restore source after raw guard proof");
    await expect(f.db.transaction().execute(async trx => {
      await sql`SET LOCAL "app.sync_in_progress" = 'false'`.execute(trx);
      await trx.updateTable("payment").set({status:"Voided"}).where("companyId","=",f.companyId).where("id","=",advance).execute();
      throw rollback;
    })).rejects.toBe(rollback);
    await f.post(advance,"void");
  }finally{await f.cleanup();}
});

postgrestTest("supplier refund choices aggregate currencies for closed orders and respect caller scope", async client => {
  const f = await prepaymentFixture();
  const other = await prepaymentFixture();
  try {
    await f.post(await f.payment(110));
    const usd = await f.payment(50, false, 1);
    await f.db.updateTable("payment").set({currencyCode:"USD"}).where("companyId","=",f.companyId).where("id","=",usd).execute();
    await f.post(usd);
    await other.post(await other.payment(110));
    await f.db.updateTable("purchaseOrder").set({status:"Completed"}).where("companyId","=",f.companyId).where("id","=",f.purchaseOrderId).execute();
    const currencies = async () => {
      const docs = await getDepositDocuments(client,f.companyId);
      const order = docs.find(doc => doc.id === f.purchaseOrderId);
      expect(order?.open).toBe(false);
      return order?.refundableCurrencyCodes;
    };
    expect(await currencies()).toEqual(["EUR","USD"]);
    const refund = await f.payment(110,true); await f.post(refund);
    expect(await currencies()).toEqual(["USD"]);
    await f.post(refund,"void");
    expect(await currencies()).toEqual(["EUR","USD"]);
    const rawKey = `crbn_refund_currencies_${crypto.randomUUID()}`;
    await f.db.insertInto("apiKey").values({name:"Refund currency test",companyId:f.companyId,createdBy:"system",
      keyHash:createHash("sha256").update(rawKey).digest("hex"),scopes:JSON.stringify({invoicing_view:[f.companyId]})}).execute();
    const caller = localApiKeyClient(rawKey)!;
    const own = await caller.rpc("get_supplier_prepayment_refund_currencies",{_company_id:f.companyId});
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{purchaseOrderId:f.purchaseOrderId,refundableCurrencyCodes:["EUR","USD"]}]);
    const foreign = await caller.rpc("get_supplier_prepayment_refund_currencies",{_company_id:other.companyId});
    expect(foreign.error).toBeNull(); expect(foreign.data).toEqual([]);
  }finally{await other.cleanup(); await f.cleanup();}
});
