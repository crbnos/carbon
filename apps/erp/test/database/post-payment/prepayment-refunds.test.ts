// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
      await f.db
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId,
          invoiceLineType: "G/L Account",
          quantity: 1,
          supplierUnitPrice: 110,
          exchangeRate: 1.1,
          accountId: f.account("loss"),
          purchaseOrderId: f.purchaseOrderId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
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
      await f.post(pay);
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
