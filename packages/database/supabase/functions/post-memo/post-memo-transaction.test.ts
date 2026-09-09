import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { paymentFixture } from "../post-payment/payment-test-fixture.ts";
import { postMemoTransaction } from "./post-memo-transaction.ts";
import { postPaymentTransaction } from "../post-payment/post-payment-transaction.ts";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
async function memoFixture(f: Fixture) {
  const id = `${f.companyId}-memo`;
  await f.db.updateTable("accountDefault").set({
    salesDiscountAccount: f.account("discount"),
  }).where("companyId", "=", f.companyId).execute();
  await f.db.insertInto("memo").values({
    id,
    memoId: "CREDIT-55",
    companyId: f.companyId,
    customerId: f.customerId,
    direction: "Credit",
    memoDate: "2026-09-07",
    currencyCode: "EUR",
    exchangeRate: 1.1,
    amount: 55,
    createdBy: "system",
  }).execute();
  return id;
}
Deno.test("memo transaction posts authoritative base50, is idempotent, and reverses actual lines after defaults change", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    const result = await postMemoTransaction(f.db, { ...f.args, memoId });
    assertEquals(
      (await postMemoTransaction(f.db, { ...f.args, memoId })).journalId,
      result.journalId,
    );
    const memo = await f.db.selectFrom("memo").selectAll().where(
      "id",
      "=",
      memoId,
    ).executeTakeFirstOrThrow();
    assertEquals(memo.status, "Posted");
    assertEquals(memo.reasonAccount, f.account("discount"));
    const original = await f.db.selectFrom("journalLine").select([
      "accountId",
      "amount",
    ]).where("journalId", "=", result.journalId!).execute();
    assertEquals(
      original.find((l) => l.accountId === f.account("control"))?.amount,
      -50,
    );
    assertEquals(
      original.find((l) => l.accountId === f.account("discount"))?.amount,
      50,
    );
    await f.db.updateTable("accountDefault").set({
      receivablesAccount: f.account("bank"),
    }).where("companyId", "=", f.companyId).execute();
    const reversed = await postMemoTransaction(f.db, {
      ...f.args,
      type: "void",
      memoId,
    });
    await postMemoTransaction(f.db, { ...f.args, type: "void", memoId });
    const reverseLines = await f.db.selectFrom("journalLine").select([
      "accountId",
      "amount",
    ]).where("journalId", "=", reversed.journalId!).execute();
    assertEquals(
      reverseLines.find((l) => l.accountId === f.account("control"))?.amount,
      50,
    );
    assertEquals(
      reverseLines.find((l) => l.accountId === f.account("discount"))?.amount,
      -50,
    );
    const journals = await f.db.selectFrom("journal").select("id").where(
      "companyId",
      "=",
      f.companyId,
    ).where("sourceType", "=", "Credit Memo").execute();
    assertEquals(journals.length, 2);
  } finally {
    await f.cleanup();
  }
});
Deno.test("memo period lock is rechecked against transaction state, overriding a stale open-period read", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    await f.db.updateTable("accountingPeriod").set({ closeStatus: "Locked" })
      .where("companyId", "=", f.companyId).execute();
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId }),
      Error,
      "locked",
    );
    const row = await f.db.selectFrom("memo").select(["status", "journalId"])
      .where("id", "=", memoId).executeTakeFirstOrThrow();
    assertEquals(row, { status: "Draft", journalId: null });
  } finally {
    await f.cleanup();
  }
});
Deno.test("memo refuses invalid precision and invalid posting accounts without writes", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    await f.db.deleteFrom("currency").where("companyGroupId", "=", f.groupId)
      .where("code", "=", "EUR").execute();
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId }),
      Error,
      "currency",
    );
    await f.db.insertInto("currency").values({
      code: "EUR",
      decimalPlaces: 2,
      companyGroupId: f.groupId,
      createdBy: "system",
    }).execute();
    await f.db.updateTable("account").set({ active: false }).where(
      "id",
      "=",
      f.account("discount"),
    ).execute();
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId }),
      Error,
      "posting accounts",
    );
    assertEquals(
      (await f.db.selectFrom("memo").select("status").where("id", "=", memoId)
        .executeTakeFirstOrThrow()).status,
      "Draft",
    );
  } finally {
    await f.cleanup();
  }
});
Deno.test("memo journal insertion failure rolls back header, lines and sequence", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    const before = await f.db.selectFrom("sequence").select("next").where(
      "companyId",
      "=",
      f.companyId,
    ).where("table", "=", "journalEntry").executeTakeFirstOrThrow();
    await assertRejects(
      () =>
        postMemoTransaction(f.db, {
          ...f.args,
          memoId,
          userId: `${f.companyId}-missing-user`,
        }),
      Error,
      "foreign key",
    );
    assertEquals(
      (await f.db.selectFrom("memo").select("status").where("id", "=", memoId)
        .executeTakeFirstOrThrow()).status,
      "Draft",
    );
    assertEquals(
      await f.db.selectFrom("sequence").select("next").where(
        "companyId",
        "=",
        f.companyId,
      ).where("table", "=", "journalEntry").executeTakeFirstOrThrow(),
      before,
    );
    assertEquals(
      (await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Credit Memo").execute()).length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("memo currency and tenant checks still apply when accounting is disabled", async () => {
  const f = await paymentFixture();
  const other = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    await f.db.updateTable("companySettings").set({ accountingEnabled: false })
      .where("id", "=", f.companyId).execute();
    await f.db.updateTable("memo").set({
      currencyCode: "USD",
      exchangeRate: 1.1,
    }).where("id", "=", memoId).execute();
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId }),
      Error,
      "exchange rate 1",
    );
    const otherMemoId = await memoFixture(other);
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId: otherMemoId }),
      Error,
      "Memo not found",
    );
    await f.db.updateTable("memo").set({ currencyCode: "EUR", amount: 0.015 })
      .where("id", "=", memoId).execute();
    await assertRejects(
      () => postMemoTransaction(f.db, { ...f.args, memoId }),
      Error,
      "precision",
    );
    await f.db.updateTable("memo").set({ amount: 0.01, exchangeRate: 16001 })
      .where("id", "=", memoId).execute();
    assertEquals(await postMemoTransaction(f.db, { ...f.args, memoId }), {
      journalId: null,
    });
    assertEquals(
      (await f.db.selectFrom("memo").select("status").where("id", "=", memoId)
        .executeTakeFirstOrThrow()).status,
      "Posted",
    );
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});

Deno.test("consumed memo cannot be voided until its applying payment is voided", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    const original = await postMemoTransaction(f.db, { ...f.args, memoId });
    const paymentId = await f.payment({ amount: 0, noApplication: true });
    await f.db.insertInto("invoiceSettlement").values({
      memoId, appliedViaPaymentId: paymentId, targetSalesInvoiceId: f.invoiceId,
      sourceAmount: 55, appliedAmount: 50, sourceExchangeRate: 1.1,
      targetExchangeRate: 1.1, appliedDate: "2026-09-07", companyId: f.companyId, createdBy: "system"
    }).execute();
    await postPaymentTransaction(f.db, { ...f.args, paymentId });
    await assertRejects(() => postMemoTransaction(f.db, { ...f.args, memoId, type: "void" }), Error, "consumed");
    assertEquals(await f.db.selectFrom("memo").select(["status", "journalId"]).where("id", "=", memoId).executeTakeFirstOrThrow(), { status: "Posted", journalId: original.journalId });
    assertEquals((await f.db.selectFrom("journal").select("id").where("companyId", "=", f.companyId).where("sourceType", "=", "Credit Memo").execute()).length, 1);
    await postPaymentTransaction(f.db, { ...f.args, paymentId, type: "void" });
    await postMemoTransaction(f.db, { ...f.args, memoId, type: "void" });
    assertEquals((await f.db.selectFrom("memo").select("status").where("id", "=", memoId).executeTakeFirstOrThrow()).status, "Voided");
  } finally { await f.cleanup(); }
});

Deno.test("draft memo reservation does not prevent memo void", async () => {
  const f = await paymentFixture();
  try {
    const memoId = await memoFixture(f);
    await postMemoTransaction(f.db, { ...f.args, memoId });
    const paymentId = await f.payment({ amount: 0, noApplication: true });
    await f.db.insertInto("invoiceSettlement").values({
      memoId, appliedViaPaymentId: paymentId, targetSalesInvoiceId: f.invoiceId,
      sourceAmount: 55, appliedAmount: 50, sourceExchangeRate: 1.1,
      targetExchangeRate: 1.1, appliedDate: "2026-09-07", companyId: f.companyId, createdBy: "system"
    }).execute();
    await postMemoTransaction(f.db, { ...f.args, memoId, type: "void" });
    await assertRejects(() => postPaymentTransaction(f.db, { ...f.args, paymentId }), Error);
  } finally { await f.cleanup(); }
});
