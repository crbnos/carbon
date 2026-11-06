// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { loadPurchaseInvoiceDocumentIds } from "@carbon/database/deposit-scope";
import { getCutoverOpenItems } from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  postPaymentTransaction,
  rebuildPaymentJournals
} from "../../../app/modules/invoicing/invoicing.service";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";

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
  f: PrepaymentFixture,
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
