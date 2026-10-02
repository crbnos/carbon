// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "../post-payment/payment-test-fixture";
import { postPaymentTransaction } from "../post-payment/post-payment-transaction";
import { postMemoTransaction } from "./post-memo-transaction";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
async function memoFixture(f: Fixture) {
  const id = `${f.companyId}-memo`;
  await f.db
    .updateTable("accountDefault")
    .set({
      salesDiscountAccount: f.account("discount")
    })
    .where("companyId", "=", f.companyId)
    .execute();
  await f.db
    .insertInto("memo")
    .values({
      id,
      memoId: "CREDIT-55",
      companyId: f.companyId,
      customerId: f.customerId,
      direction: "Credit",
      memoDate: "2026-09-07",
      currencyCode: "EUR",
      exchangeRate: 1.1,
      amount: 55,
      createdBy: "system"
    })
    .execute();
  return id;
}
databaseTest(
  "memo transaction posts authoritative base50, is idempotent, and reverses actual lines after defaults change",
  async () => {
    const f = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      const result = await postMemoTransaction(f.db, { ...f.args, memoId });
      expect(
        (await postMemoTransaction(f.db, { ...f.args, memoId })).journalId
      ).toEqual(result.journalId);
      const memo = await f.db
        .selectFrom("memo")
        .selectAll()
        .where("id", "=", memoId)
        .executeTakeFirstOrThrow();
      expect(memo.status).toEqual("Posted");
      expect(memo.reasonAccount).toEqual(f.account("discount"));
      const original = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", result.journalId!)
        .execute();
      expect(
        original.find((l) => l.accountId === f.account("control"))?.amount
      ).toEqual(-50);
      expect(
        original.find((l) => l.accountId === f.account("discount"))?.amount
      ).toEqual(50);
      await f.db
        .updateTable("accountDefault")
        .set({
          receivablesAccount: f.account("bank")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const reversed = await postMemoTransaction(f.db, {
        ...f.args,
        type: "void",
        memoId
      });
      await postMemoTransaction(f.db, { ...f.args, type: "void", memoId });
      const reverseLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", reversed.journalId!)
        .execute();
      expect(
        reverseLines.find((l) => l.accountId === f.account("control"))?.amount
      ).toEqual(50);
      expect(
        reverseLines.find((l) => l.accountId === f.account("discount"))?.amount
      ).toEqual(-50);
      const journals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Credit Memo")
        .execute();
      expect(journals.length).toEqual(2);
    } finally {
      await f.cleanup();
    }
  }
);
databaseTest(
  "memo period lock is rechecked against transaction state, overriding a stale open-period read",
  async () => {
    const f = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      await f.db
        .updateTable("accountingPeriod")
        .set({ closeStatus: "Locked" })
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId })
      ).rejects.toThrow("locked");
      const row = await f.db
        .selectFrom("memo")
        .select(["status", "journalId"])
        .where("id", "=", memoId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "Draft", journalId: null });
    } finally {
      await f.cleanup();
    }
  }
);
databaseTest(
  "memo refuses invalid precision and invalid posting accounts without writes",
  async () => {
    const f = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      await f.db
        .deleteFrom("currency")
        .where("companyGroupId", "=", f.groupId)
        .where("code", "=", "EUR")
        .execute();
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId })
      ).rejects.toThrow("currency");
      await f.db
        .insertInto("currency")
        .values({
          code: "EUR",
          decimalPlaces: 2,
          companyGroupId: f.groupId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .updateTable("account")
        .set({ active: false })
        .where("id", "=", f.account("discount"))
        .execute();
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId })
      ).rejects.toThrow("posting accounts");
      expect(
        (
          await f.db
            .selectFrom("memo")
            .select("status")
            .where("id", "=", memoId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);
databaseTest(
  "memo journal insertion failure rolls back header, lines and sequence",
  async () => {
    const f = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      const before = await f.db
        .selectFrom("sequence")
        .select("next")
        .where("companyId", "=", f.companyId)
        .where("table", "=", "journalEntry")
        .executeTakeFirstOrThrow();
      await expect(
        postMemoTransaction(f.db, {
          ...f.args,
          memoId,
          userId: `${f.companyId}-missing-user`
        })
      ).rejects.toThrow("foreign key");
      expect(
        (
          await f.db
            .selectFrom("memo")
            .select("status")
            .where("id", "=", memoId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
      expect(
        await f.db
          .selectFrom("sequence")
          .select("next")
          .where("companyId", "=", f.companyId)
          .where("table", "=", "journalEntry")
          .executeTakeFirstOrThrow()
      ).toEqual(before);
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Credit Memo")
            .execute()
        ).length
      ).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "memo currency and tenant checks still apply when accounting is disabled",
  async () => {
    const f = await paymentFixture();
    const other = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      await f.db
        .updateTable("companySettings")
        .set({ accountingEnabled: false })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("memo")
        .set({
          currencyCode: "USD",
          exchangeRate: 1.1
        })
        .where("id", "=", memoId)
        .execute();
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId })
      ).rejects.toThrow("exchange rate 1");
      const otherMemoId = await memoFixture(other);
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId: otherMemoId })
      ).rejects.toThrow("Memo not found");
      await f.db
        .updateTable("memo")
        .set({ currencyCode: "EUR", amount: 0.015 })
        .where("id", "=", memoId)
        .execute();
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId })
      ).rejects.toThrow("precision");
      await f.db
        .updateTable("memo")
        .set({ amount: 0.01, exchangeRate: 16001 })
        .where("id", "=", memoId)
        .execute();
      expect(await postMemoTransaction(f.db, { ...f.args, memoId })).toEqual({
        journalId: null
      });
      expect(
        (
          await f.db
            .selectFrom("memo")
            .select("status")
            .where("id", "=", memoId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Posted");
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  }
);

databaseTest(
  "consumed memo cannot be voided until its applying payment is voided",
  async () => {
    const f = await paymentFixture();
    try {
      const memoId = await memoFixture(f);
      const original = await postMemoTransaction(f.db, { ...f.args, memoId });
      const paymentId = await f.payment({ amount: 0, noApplication: true });
      await f.db
        .insertInto("invoiceSettlement")
        .values({
          memoId,
          appliedViaPaymentId: paymentId,
          targetSalesInvoiceId: f.invoiceId,
          sourceAmount: 55,
          appliedAmount: 50,
          sourceExchangeRate: 1.1,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await postPaymentTransaction(f.db, { ...f.args, paymentId });
      await expect(
        postMemoTransaction(f.db, { ...f.args, memoId, type: "void" })
      ).rejects.toThrow("consumed");
      expect(
        await f.db
          .selectFrom("memo")
          .select(["status", "journalId"])
          .where("id", "=", memoId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Posted", journalId: original.journalId });
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Credit Memo")
            .execute()
        ).length
      ).toEqual(1);
      await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId,
        type: "void"
      });
      await postMemoTransaction(f.db, { ...f.args, memoId, type: "void" });
      expect(
        (
          await f.db
            .selectFrom("memo")
            .select("status")
            .where("id", "=", memoId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Voided");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("draft memo reservation does not prevent memo void", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    await postMemoTransaction(f.db, { ...f.args, memoId });
    const paymentId = await f.payment({ amount: 0, noApplication: true });
    await f.db
      .insertInto("invoiceSettlement")
      .values({
        memoId,
        appliedViaPaymentId: paymentId,
        targetSalesInvoiceId: f.invoiceId,
        sourceAmount: 55,
        appliedAmount: 50,
        sourceExchangeRate: 1.1,
        targetExchangeRate: 1.1,
        appliedDate: "2026-09-07",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await postMemoTransaction(f.db, { ...f.args, memoId, type: "void" });
    await expect(
      postPaymentTransaction(f.db, { ...f.args, paymentId })
    ).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});
