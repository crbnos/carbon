// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Voids of documents dated before the accounting cutover, after the enable.
// An inventory document or an invoice refuses its void. A payment or a memo
// builds its posting again and negates it today, so the void nets the
// opening journal's lines for that document to zero.

import {
  getCutoverInventory,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { GL_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postMemo from "../post-memo";
import postPayment from "../post-payment";
import postReceipt from "../post-receipt";
import postSalesInvoice from "../post-sales-invoice";
import activateAccounting from ".";
import {
  type AccountName,
  activationFixture,
  type Fixture,
  glBalance,
  moveBeforeCutover,
  pay,
  postServiceInvoice,
  receiveFiveParts,
  USER,
  unwrap
} from "./activation-test-fixture";

/** Sets the scrap default the fixture leaves empty, saves a trial balance
 *  that ties to Carbon's open items, and enables. */
async function enable(
  f: Fixture,
  lines: { account: AccountName; debit: number; credit: number }[]
) {
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
    await activateAccounting(f.ctx, { ...args, confirmation: f.companyName })
  );
}

/** A posted credit memo of `amount` for the customer. */
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

/** The sum of an account's lines in Posted and Reversed journals for one
 *  document. */
async function documentBalance(
  f: Fixture,
  account: AccountName,
  documentType: "Invoice" | "Payment" | "Memo",
  documentId: string
) {
  const row = await f.db
    .selectFrom("journalLine as line")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select(sql<number>`coalesce(sum("line"."amount"), 0)`.as("balance"))
    .where("line.companyId", "=", f.companyId)
    .where("line.accountId", "=", f.account(account))
    .where("line.documentType", "=", documentType)
    .where("line.documentId", "=", documentId)
    .where("journal.status", "in", [...GL_JOURNAL_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

databaseTest(
  "a receipt dated before the cutover refuses its void after the enable",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      const receipt = await f.db
        .selectFrom("receipt")
        .select("id")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await moveBeforeCutover(f);
      const [part] = await getCutoverInventory(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      expect(part).toMatchObject({ quantity: 5, unitCost: 8 });
      await enable(f, [
        { account: "inventory", debit: 40, credit: 0 },
        { account: "grni", debit: 0, credit: 40 }
      ]);

      const result = await postReceipt(f.ctx, {
        type: "void",
        receiptId: receipt.id
      });
      expect(result.error?.message).toBe(
        "This document is from before your accounting cutover. Record a return or an inventory adjustment instead."
      );
      const after = await f.db
        .selectFrom("receipt")
        .select("status")
        .where("companyId", "=", f.companyId)
        .where("id", "=", receipt.id)
        .executeTakeFirstOrThrow();
      expect(after.status).toBe("Posted");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice dated before the cutover refuses its void after the enable",
  async () => {
    const f = await activationFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      await moveBeforeCutover(f);
      await enable(f, [
        { account: "receivables", debit: 100, credit: 0 },
        { account: "retained-earnings", debit: 0, credit: 100 }
      ]);
      const status = async () =>
        (
          await f.db
            .selectFrom("salesInvoice")
            .select("status")
            .where("companyId", "=", f.companyId)
            .where("id", "=", invoiceId)
            .executeTakeFirstOrThrow()
        ).status;
      const before = await status();
      expect(before).not.toBe("Voided");

      const result = await postSalesInvoice(f.ctx, {
        type: "void",
        invoiceId
      });
      expect(result.error?.message).toBe(
        "This invoice is from before your accounting cutover. Issue a credit memo instead."
      );
      expect(await status()).toBe(before);
      expect(await glBalance(f, "receivables")).toBeCloseTo(100, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a payment and a memo dated before the cutover void against their opening lines",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: an invoice of 100; a payment of 50 that applies
      // 40 and leaves 10 on account; a credit memo of 30, unapplied.
      const invoiceId = await postServiceInvoice(f);
      const paymentId = await pay(f, {
        id: "pay-1",
        invoiceId,
        amount: 50,
        applied: 40
      });
      unwrap(await postPayment(f.ctx, { type: "post", paymentId }));
      const memoId = await postCreditMemo(f, 30);
      await moveBeforeCutover(f);

      // Receivables open at the cutover: 100 − 40 − 10 − 30.
      await enable(f, [
        { account: "receivables", debit: 20, credit: 0 },
        { account: "bank", debit: 50, credit: 0 },
        { account: "retained-earnings", debit: 0, credit: 70 }
      ]);
      expect(await glBalance(f, "receivables")).toBeCloseTo(20, 6);
      expect(
        await documentBalance(f, "receivables", "Payment", paymentId)
      ).toBeCloseTo(-10, 6);
      expect(
        await documentBalance(f, "receivables", "Memo", memoId)
      ).toBeCloseTo(-30, 6);

      unwrap(await postPayment(f.ctx, { type: "void", paymentId }));
      unwrap(await postMemo(f.ctx, { type: "void", memoId }));

      // The opening journal opened 2 receivables lines for the payment: its
      // 10 on account, and the 40 it settled on the invoice before the
      // cutover. The payment's void nets both to zero.
      const lines = await f.db
        .selectFrom("journalLine as line")
        .innerJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "line.journalId")
            .onRef("journal.companyId", "=", "line.companyId")
        )
        .select([
          "journal.sourceType",
          "journal.description as journalDescription",
          "line.amount",
          "line.description",
          "line.documentType",
          "line.documentId"
        ])
        .where("line.companyId", "=", f.companyId)
        .where("line.accountId", "=", f.account("receivables"))
        .where("journal.status", "in", [...GL_JOURNAL_STATUSES])
        .execute();
      const sum = (rows: typeof lines) =>
        rows.reduce((total, row) => total + Number(row.amount), 0);
      const paymentOpening = lines.filter(
        (row) =>
          row.sourceType === "Opening Balance" &&
          ((row.documentType === "Payment" && row.documentId === paymentId) ||
            (row.documentId === invoiceId &&
              row.description ===
                "Accounts Receivable (settled before cutover)"))
      );
      expect(paymentOpening).toHaveLength(2);
      const paymentVoid = lines.filter(
        (row) => row.journalDescription === "VOID Payment PAY-1"
      );
      expect(sum(paymentOpening)).toBeCloseTo(-50, 6);
      expect(sum(paymentOpening) + sum(paymentVoid)).toBeCloseTo(0, 6);
      // The memo's opening line and its void net to zero.
      expect(
        await documentBalance(f, "receivables", "Memo", memoId)
      ).toBeCloseTo(0, 6);

      // The invoice is open in full again, cash is back to the trial
      // balance less the payment, and Migration Clearing is untouched.
      expect(await glBalance(f, "receivables")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "bank")).toBeCloseTo(0, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);

      // The voids post today, in the period that holds today, and never on
      // Migration Clearing.
      const period = await f.db
        .selectFrom("accountingPeriod")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("startDate", "<=", f.today)
        .where("endDate", ">=", f.today)
        .executeTakeFirstOrThrow();
      const voids = await f.db
        .selectFrom("journal")
        .select(["id", "status", "postingDate", "accountingPeriodId"])
        .where("companyId", "=", f.companyId)
        .where("description", "in", [
          "VOID Payment PAY-1",
          "VOID Memo CREDIT-1"
        ])
        .execute();
      expect(voids).toHaveLength(2);
      for (const journal of voids) {
        expect(journal).toMatchObject({
          status: "Posted",
          postingDate: f.today,
          accountingPeriodId: period.id
        });
      }
      const clearing = await f.db
        .selectFrom("journalLine")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where(
          "journalId",
          "in",
          voids.map((journal) => journal.id)
        )
        .where("accountId", "=", f.account("migration-clearing"))
        .execute();
      expect(clearing).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
