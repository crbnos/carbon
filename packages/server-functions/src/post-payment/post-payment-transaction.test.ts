// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "./payment-test-fixture";
import { postPaymentTransaction } from "./post-payment-transaction";

databaseTest(
  "posting locks authoritative snapshots, overwrites forged rates, and is idempotent",
  async () => {
    const f = await paymentFixture();
    try {
      const paymentId = await f.payment();
      const result = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });
      const row = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(row.sourceAmount).toEqual(110);
      expect(row.appliedAmount).toEqual(100);
      expect(row.sourceExchangeRate).toEqual(1.1);
      expect(row.targetExchangeRate).toEqual(1.1);
      expect(row.fxGainLossAmount).toEqual(0);
      expect(
        (await postPaymentTransaction(f.db, { ...f.args, paymentId })).journalId
      ).toEqual(result.journalId);
      const journalLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", result.journalId!)
        .execute();
      expect(
        journalLines.find((line) => line.accountId === f.account("bank"))
          ?.amount
      ).toEqual(100);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "target over-consumption rolls back and leaves the payment draft unchanged",
  async () => {
    const f = await paymentFixture();
    try {
      const paymentId = await f.payment({ amount: 111, sourceAmount: 111 });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("exceeds");
      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(payment.status).toEqual("Draft");
      expect(payment.journalId).toEqual(null);
      const draft = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(draft.sourceExchangeRate).toEqual(99);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "prior credit is attributed to its original source and source void is blocked until consumer void",
  async () => {
    const f = await paymentFixture();
    try {
      const sourceId = await f.payment({ noApplication: true, rate: 1 });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
      const paymentId = await f.payment({ amount: 0, rate: 1.5 });
      await postPaymentTransaction(f.db, { ...f.args, paymentId });
      const row = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(row.sourcePaymentId).toEqual(sourceId);
      expect(row.sourceExchangeRate).toEqual(1);
      expect(row.fxGainLossAmount).toEqual(10);
      await expect(
        postPaymentTransaction(f.db, {
          ...f.args,
          paymentId: sourceId,
          type: "void"
        })
      ).rejects.toThrow("consum");
      await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId,
        type: "void"
      });
      await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId: sourceId,
        type: "void"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sequence fault after settlement replacement rolls the entire post back",
  async () => {
    const f = await paymentFixture();
    try {
      const paymentId = await f.payment();
      const before = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .execute();
      await f.db
        .deleteFrom("sequence")
        .where("companyId", "=", f.companyId)
        .where("table", "=", "journalEntry")
        .execute();
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("no result");
      expect(
        await f.db
          .selectFrom("invoiceSettlement")
          .selectAll()
          .where("paymentId", "=", paymentId)
          .execute()
      ).toEqual(before);
      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(payment).toEqual({ status: "Draft", journalId: null });
      expect(
        await f.db
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Payment")
          .execute()
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "accounting-disabled posting still rejects an invalid bank account",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingEnabled: false })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("account")
        .set({ active: false })
        .where("id", "=", f.account("bank"))
        .execute();
      const paymentId = await f.payment();
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("bank account");
      expect(
        (
          await f.db
            .selectFrom("payment")
            .select("status")
            .where("id", "=", paymentId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a wrong new-credit control account class cannot create an unbalanced stored ledger",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          receivablesAccount: f.account("sales")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const paymentId = await f.payment({ amount: 165 });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("account class");
      expect(
        (
          await f.db
            .selectFrom("payment")
            .select("status")
            .where("id", "=", paymentId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "positive document remainder with zero base carrying remains eligible until its final unit",
  async () => {
    const f = await paymentFixture();
    try {
      const invoiceId = await f.invoice({ amount: 0.01, rate: 16001 });
      const sourceId = await f.payment({
        noApplication: true,
        amount: 160.01,
        rate: 16001
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
      const firstId = await f.payment({
        amount: 0,
        rate: 16001,
        invoiceId,
        sourceAmount: 160,
        appliedAmount: 0.01
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: firstId });
      const partial = await f.db
        .selectFrom("salesInvoices")
        .select(["status", "balance"])
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(partial.status).toEqual("Partially Paid");
      const lastId = await f.payment({
        amount: 0,
        rate: 16001,
        invoiceId,
        sourceAmount: 0.01,
        appliedAmount: 0
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: lastId });
      const final = await f.db
        .selectFrom("invoiceSettlement")
        .select(["sourceAmount", "appliedAmount", "fxGainLossAmount"])
        .where("paymentId", "=", lastId)
        .executeTakeFirstOrThrow();
      expect(final).toEqual({
        sourceAmount: 0.01,
        appliedAmount: 0,
        fxGainLossAmount: 0
      });
      expect(
        (
          await f.db
            .selectFrom("salesInvoices")
            .select("status")
            .where("id", "=", invoiceId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Paid");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "changed defaults preserve original invoice and prior-credit control accounts",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .insertInto("account")
        .values(
          ["credit-control", "new-control"].map((name) => ({
            id: f.account(name),
            name,
            class: "Asset" as const,
            incomeBalance: "Balance Sheet" as const,
            companyGroupId: f.groupId,
            createdBy: "system"
          }))
        )
        .execute();
      await f.db
        .updateTable("accountDefault")
        .set({
          receivablesAccount: f.account("credit-control")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const sourceId = await f.payment({ noApplication: true });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
      await f.db
        .updateTable("accountDefault")
        .set({
          receivablesAccount: f.account("new-control")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const paymentId = await f.payment({ amount: 0 });
      const result = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "description"])
        .where("journalId", "=", result.journalId!)
        .execute();
      expect(
        lines.find((line) => line.description === "Accounts Receivable")
          ?.accountId
      ).toEqual(f.account("control"));
      expect(
        lines.find(
          (line) => line.description === "Accounts Receivable (credit applied)"
        )?.accountId
      ).toEqual(f.account("credit-control"));
      expect(
        lines.some((line) => line.accountId === f.account("new-control"))
      ).toEqual(false);
    } finally {
      await f.cleanup();
    }
  }
);

for (const isAR of [true, false]) {
  databaseTest(
    `${isAR ? "AR" : "AP"} mixed-sign original controls settle their net carrying without fictitious FX`,
    async () => {
      const f = await paymentFixture();
      try {
        const invoiceId = isAR ? f.invoiceId : `${f.companyId}-purchase`;
        const controlId = isAR ? f.account("control") : f.account("payable");
        const paymentId = await f.payment({
          amount: 90,
          rate: 1,
          sourceAmount: 90,
          appliedAmount: 90,
          noApplication: !isAR
        });
        const journal = await f.db
          .selectFrom("journal")
          .select(["id", "accountingPeriodId"])
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Sales Invoice")
          .executeTakeFirstOrThrow();
        if (isAR) {
          await f.db
            .updateTable("salesInvoice")
            .set({ exchangeRate: 1 })
            .where("id", "=", invoiceId)
            .where("companyId", "=", f.companyId)
            .execute();
          await f.db
            .insertInto("salesInvoiceLine")
            .values({
              invoiceId,
              invoiceLineType: "Service",
              quantity: 1,
              unitPrice: -10,
              unitOfMeasureCode: "EA",
              companyId: f.companyId,
              createdBy: "system"
            })
            .execute();
        } else {
          const supplier = await f.db
            .insertInto("supplier")
            .values({
              name: "Mixed-sign supplier",
              companyId: f.companyId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const interaction = await f.db
            .insertInto("supplierInteraction")
            .values({
              supplierId: supplier.id,
              companyId: f.companyId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await f.db
            .insertInto("account")
            .values({
              id: controlId,
              name: "Mixed-sign AP",
              class: "Liability",
              incomeBalance: "Balance Sheet",
              companyGroupId: f.groupId,
              createdBy: "system"
            })
            .execute();
          await f.db
            .updateTable("accountDefault")
            .set({
              payablesAccount: controlId,
              supplierPaymentDiscountAccount: f.account("discount"),
              supplierWriteOffAccount: f.account("sales")
            })
            .where("companyId", "=", f.companyId)
            .execute();
          await f.db
            .insertInto("purchaseInvoice")
            .values({
              id: invoiceId,
              invoiceId,
              supplierId: supplier.id,
              supplierInteractionId: interaction.id,
              currencyCode: "EUR",
              exchangeRate: 1,
              status: "Open",
              companyId: f.companyId,
              createdBy: "system"
            })
            .execute();
          await f.db
            .insertInto("purchaseInvoiceLine")
            .values(
              [100, -10].map((amount) => ({
                invoiceId,
                invoiceLineType: "G/L Account" as const,
                quantity: 1,
                supplierUnitPrice: amount,
                exchangeRate: 1,
                accountId: f.account("loss"),
                companyId: f.companyId,
                createdBy: "system"
              }))
            )
            .execute();
          await f.db
            .updateTable("payment")
            .set({
              paymentType: "Disbursement",
              customerId: null,
              supplierId: supplier.id
            })
            .where("id", "=", paymentId)
            .where("companyId", "=", f.companyId)
            .execute();
          await f.db
            .insertInto("invoiceSettlement")
            .values({
              paymentId,
              targetPurchaseInvoiceId: invoiceId,
              sourceAmount: 90,
              appliedAmount: 90,
              sourceExchangeRate: 1,
              targetExchangeRate: 1,
              appliedDate: "2026-09-07",
              companyId: f.companyId,
              createdBy: "system"
            })
            .execute();
        }
        const extraJournal = await f.db
          .insertInto("journal")
          .values({
            journalEntryId: `${invoiceId}-adjustment`,
            accountingPeriodId: journal.accountingPeriodId,
            companyId: f.companyId,
            sourceType: isAR ? "Sales Invoice" : "Purchase Invoice",
            status: "Posted",
            postingDate: "2026-09-01",
            createdBy: "system"
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await f.db
          .insertInto("journalLine")
          .values(
            (isAR ? [-10] : [100, -10]).flatMap((amount) =>
              [
                {
                  accountId: controlId,
                  description: isAR ? "Accounts Receivable" : "Accounts Payable"
                },
                {
                  accountId: isAR ? f.account("sales") : f.account("loss"),
                  description: "Invoice offset"
                }
              ].map((line) => ({
                ...line,
                amount,
                quantity: 1,
                journalId: extraJournal.id,
                documentId: invoiceId,
                documentType: "Invoice" as const,
                journalLineReference: invoiceId,
                companyId: f.companyId
              }))
            )
          )
          .execute();
        const result = await postPaymentTransaction(f.db, {
          ...f.args,
          paymentId
        });
        const settlement = await f.db
          .selectFrom("invoiceSettlement")
          .select(["sourceAmount", "appliedAmount", "fxGainLossAmount"])
          .where("paymentId", "=", paymentId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        expect(settlement).toEqual({
          sourceAmount: 90,
          appliedAmount: 90,
          fxGainLossAmount: 0
        });
        const paymentLines = await f.db
          .selectFrom("journalLine")
          .select(["amount", "accountId"])
          .where("journalId", "=", result.journalId!)
          .where("companyId", "=", f.companyId)
          .execute();
        expect(
          paymentLines
            .filter((line) => line.accountId === controlId)
            .reduce((sum, line) => sum + Number(line.amount), 90)
        ).toEqual(0);
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "intercompany invoice settlement retains its original control after defaults change",
  async () => {
    const f = await paymentFixture();
    try {
      const invoiceId = await f.invoice({
        controlDescription: "IC Receivables"
      });
      await f.db
        .updateTable("accountDefault")
        .set({ receivablesAccount: f.account("bank") })
        .where("companyId", "=", f.companyId)
        .execute();
      const paymentId = await f.payment({ invoiceId });
      const posted = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", posted.journalId!)
        .execute();
      expect(
        lines.find((line) => line.accountId === f.account("control"))?.amount
      ).toEqual(-100);
    } finally {
      await f.cleanup();
    }
  }
);

// --- Employee reimbursement payouts -----------------------------------------

databaseTest(
  "a full employee payout settles the reimbursement, debiting the payable it was booked to",
  async () => {
    const f = await paymentFixture();
    try {
      const reimbursementId = await f.reimbursement();
      const paymentId = await f.reimbursementPayment({ reimbursementId });
      const result = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });
      const row = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .executeTakeFirstOrThrow();
      // Exactly one target column is set, and the forged rates were overwritten.
      expect(row.targetReimbursementId).toEqual(reimbursementId);
      expect(row.targetSalesInvoiceId).toEqual(null);
      expect(row.targetPurchaseInvoiceId).toEqual(null);
      expect(row.targetMemoId).toEqual(null);
      expect(Number(row.appliedAmount)).toEqual(620);
      expect(Number(row.sourceAmount)).toEqual(620);
      expect(Number(row.targetExchangeRate)).toEqual(1);
      expect(Number(row.sourceExchangeRate)).toEqual(1);
      expect(Number(row.discountAmount)).toEqual(0);
      expect(Number(row.writeOffAmount)).toEqual(0);

      const journalLines = await f.db
        .selectFrom("journalLine")
        .innerJoin("account", "account.id", "journalLine.accountId")
        .select([
          "journalLine.accountId as accountId",
          "journalLine.amount as amount",
          "journalLine.description as description",
          "account.class as class"
        ])
        .where("journalLine.journalId", "=", result.journalId!)
        .execute();
      // Stored amounts are NATURAL-balance signed, so the bank credit and the
      // payable debit BOTH store −620 and the journal does NOT sum to zero.
      // Convert to true debit(+)/credit(−) space before asserting it balances:
      // an asset/expense line's stored sign IS its debit sign, a
      // liability/equity/revenue line's is inverted.
      const signedDebit = journalLines.reduce(
        (sum, line) =>
          sum +
          (line.class === "Asset" || line.class === "Expense"
            ? Number(line.amount)
            : -Number(line.amount)),
        0
      );
      expect(signedDebit).toEqual(0);
      const bank = journalLines.find(
        (line) => line.accountId === f.account("bank")
      );
      const payable = journalLines.find(
        (line) => line.accountId === f.account("employee-payable")
      );
      // Bank (Asset) CREDITED 620; employee payable (Liability) DEBITED 620.
      expect(Number(bank?.amount)).toEqual(-620);
      expect(Number(payable?.amount)).toEqual(-620);
      expect(payable?.description).toEqual("Employee Reimbursements Payable");
      // Nothing lands on the AR control account the AR fixture uses.
      expect(
        journalLines.some((line) => line.accountId === f.account("control"))
      ).toEqual(false);

      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(payment.status).toEqual("Posted");
      expect(payment.journalId).toEqual(result.journalId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a partial employee payout leaves the rest of the reimbursement outstanding",
  async () => {
    const f = await paymentFixture();
    try {
      const reimbursementId = await f.reimbursement();
      const first = await f.reimbursementPayment({
        reimbursementId,
        amount: 200,
        appliedAmount: 200
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: first });
      // The remainder is still settleable; over-paying it is not.
      const rest = await f.reimbursementPayment({
        reimbursementId,
        amount: 420,
        appliedAmount: 420
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: rest });
      const rows = await f.db
        .selectFrom("invoiceSettlement")
        .select(["appliedAmount", "sourceAmount"])
        .where("targetReimbursementId", "=", reimbursementId)
        .execute();
      expect(
        rows.reduce((sum, row) => sum + Number(row.appliedAmount), 0)
      ).toEqual(620);
      const overpay = await f.reimbursementPayment({
        reimbursementId,
        amount: 1,
        appliedAmount: 1
      });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId: overpay })
      ).rejects.toThrow();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an employee payout carrying a discount, a second target or a Draft reimbursement is refused",
  async () => {
    const f = await paymentFixture();
    try {
      const reimbursementId = await f.reimbursement();
      const withDiscount = await f.reimbursementPayment({
        reimbursementId,
        appliedAmount: 600,
        discountAmount: 20
      });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId: withDiscount })
      ).rejects.toThrow("Unsupported payment settlement target");

      // A second target cannot even be staged: `invoiceSettlement_target_check`
      // is a DB CHECK that exactly one target column is set, so the in-function
      // guard is defence in depth rather than the only barrier.
      const secondTarget = await f.reimbursementPayment({ reimbursementId });
      await expect(
        f.db
          .updateTable("invoiceSettlement")
          .set({
            targetSalesInvoiceId: f.invoiceId
          })
          .where("paymentId", "=", secondTarget)
          .execute()
      ).rejects.toThrow("invoiceSettlement_target_check");

      const draft = await f.reimbursement({ status: "Draft" });
      const againstDraft = await f.reimbursementPayment({
        reimbursementId: draft
      });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId: againstDraft })
      ).rejects.toThrow("status Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reimbursement whose stored payable disagrees with its posted journal refuses to pay out",
  async () => {
    const f = await paymentFixture();
    try {
      // The row records `employee-payable` but the journal credited the
      // liability to `control` — the payout must refuse rather than debit an
      // account the liability was never booked to.
      const reimbursementId = await f.reimbursement({
        journalPayableAccountId: f.account("control")
      });
      const paymentId = await f.reimbursementPayment({ reimbursementId });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("disagrees with its posted journal");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reimbursement posted with accounting disabled cannot be paid out once accounting is on",
  async () => {
    const f = await paymentFixture();
    try {
      // No journal at all — the shape a reimbursement has when it POSTED while
      // `accountingEnabled` was false: its employee payable was never credited.
      // Paying it out with accounting on would debit a liability that does not
      // exist, so the missing-control guard must bite. Seeding
      // `targetControlById` from the reimbursement ROW made that guard
      // unreachable for a reimbursement, which is exactly the hole this pins.
      const reimbursementId = await f.reimbursement({ withJournal: false });
      const paymentId = await f.reimbursementPayment({ reimbursementId });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("Target is missing its original control account");
    } finally {
      await f.cleanup();
    }
  }
);
