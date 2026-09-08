import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { paymentFixture } from "./payment-test-fixture.ts";
import { postPaymentTransaction } from "./post-payment-transaction.ts";

Deno.test("posting locks authoritative snapshots, overwrites forged rates, and is idempotent", async () => {
  const f = await paymentFixture();
  try {
    const paymentId = await f.payment();
    const result = await postPaymentTransaction(f.db, { ...f.args, paymentId });
    const row = await f.db.selectFrom("invoiceSettlement").selectAll().where(
      "paymentId",
      "=",
      paymentId,
    ).executeTakeFirstOrThrow();
    assertEquals(row.sourceAmount, 110);
    assertEquals(row.appliedAmount, 100);
    assertEquals(row.sourceExchangeRate, 1.1);
    assertEquals(row.targetExchangeRate, 1.1);
    assertEquals(row.fxGainLossAmount, 0);
    assertEquals(
      (await postPaymentTransaction(f.db, { ...f.args, paymentId })).journalId,
      result.journalId,
    );
    const journalLines = await f.db.selectFrom("journalLine").select([
      "accountId",
      "amount",
    ]).where("journalId", "=", result.journalId!).execute();
    assertEquals(
      journalLines.find((line) => line.accountId === f.account("bank"))?.amount,
      100,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("target over-consumption rolls back and leaves the payment draft unchanged", async () => {
  const f = await paymentFixture();
  try {
    const paymentId = await f.payment({ amount: 111, sourceAmount: 111 });
    await assertRejects(
      () => postPaymentTransaction(f.db, { ...f.args, paymentId }),
      Error,
      "exceeds",
    );
    const payment = await f.db.selectFrom("payment").select([
      "status",
      "journalId",
    ]).where("id", "=", paymentId).executeTakeFirstOrThrow();
    assertEquals(payment.status, "Draft");
    assertEquals(payment.journalId, null);
    const draft = await f.db.selectFrom("invoiceSettlement").selectAll().where(
      "paymentId",
      "=",
      paymentId,
    ).executeTakeFirstOrThrow();
    assertEquals(draft.sourceExchangeRate, 99);
  } finally {
    await f.cleanup();
  }
});

Deno.test("prior credit is attributed to its original source and source void is blocked until consumer void", async () => {
  const f = await paymentFixture();
  try {
    const sourceId = await f.payment({ noApplication: true, rate: 1 });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
    const paymentId = await f.payment({ amount: 0, rate: 1.5 });
    await postPaymentTransaction(f.db, { ...f.args, paymentId });
    const row = await f.db.selectFrom("invoiceSettlement").selectAll().where(
      "paymentId",
      "=",
      paymentId,
    ).executeTakeFirstOrThrow();
    assertEquals(row.sourcePaymentId, sourceId);
    assertEquals(row.sourceExchangeRate, 1);
    assertEquals(row.fxGainLossAmount, 10);
    await assertRejects(
      () =>
        postPaymentTransaction(f.db, {
          ...f.args,
          paymentId: sourceId,
          type: "void",
        }),
      Error,
      "consum",
    );
    await postPaymentTransaction(f.db, { ...f.args, paymentId, type: "void" });
    await postPaymentTransaction(f.db, {
      ...f.args,
      paymentId: sourceId,
      type: "void",
    });
  } finally {
    await f.cleanup();
  }
});

Deno.test("a sequence fault after settlement replacement rolls the entire post back", async () => {
  const f = await paymentFixture();
  try {
    const paymentId = await f.payment();
    const before = await f.db.selectFrom("invoiceSettlement").selectAll().where(
      "paymentId",
      "=",
      paymentId,
    ).execute();
    await f.db.deleteFrom("sequence").where("companyId", "=", f.companyId)
      .where("table", "=", "journalEntry").execute();
    await assertRejects(
      () => postPaymentTransaction(f.db, { ...f.args, paymentId }),
      Error,
      "no result",
    );
    assertEquals(
      await f.db.selectFrom("invoiceSettlement").selectAll().where(
        "paymentId",
        "=",
        paymentId,
      ).execute(),
      before,
    );
    const payment = await f.db.selectFrom("payment").select([
      "status",
      "journalId",
    ]).where("id", "=", paymentId).executeTakeFirstOrThrow();
    assertEquals(payment, { status: "Draft", journalId: null });
    assertEquals(
      await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Payment").execute(),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("accounting-disabled posting still rejects an invalid bank account", async () => {
  const f = await paymentFixture();
  try {
    await f.db.updateTable("companySettings").set({ accountingEnabled: false })
      .where("id", "=", f.companyId).execute();
    await f.db.updateTable("account").set({ active: false }).where(
      "id",
      "=",
      f.account("bank"),
    ).execute();
    const paymentId = await f.payment();
    await assertRejects(
      () => postPaymentTransaction(f.db, { ...f.args, paymentId }),
      Error,
      "bank account",
    );
    assertEquals(
      (await f.db.selectFrom("payment").select("status").where(
        "id",
        "=",
        paymentId,
      ).executeTakeFirstOrThrow()).status,
      "Draft",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("a wrong control account class cannot create an unbalanced stored ledger", async () => {
  const f = await paymentFixture();
  try {
    await f.db.updateTable("accountDefault").set({
      receivablesAccount: f.account("sales"),
    }).where("companyId", "=", f.companyId).execute();
    const paymentId = await f.payment();
    await assertRejects(
      () => postPaymentTransaction(f.db, { ...f.args, paymentId }),
      Error,
      "account class",
    );
    assertEquals(
      (await f.db.selectFrom("payment").select("status").where(
        "id",
        "=",
        paymentId,
      ).executeTakeFirstOrThrow()).status,
      "Draft",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("positive document remainder with zero base carrying remains eligible until its final unit", async () => {
  const f = await paymentFixture();
  try {
    const invoiceId = await f.invoice({ amount: 0.01, rate: 16001 });
    const sourceId = await f.payment({
      noApplication: true,
      amount: 160.01,
      rate: 16001,
    });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
    const firstId = await f.payment({
      amount: 0,
      rate: 16001,
      invoiceId,
      sourceAmount: 160,
      appliedAmount: 0.01,
    });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: firstId });
    const partial = await f.db.selectFrom("salesInvoices").select([
      "status",
      "balance",
    ]).where("id", "=", invoiceId).executeTakeFirstOrThrow();
    assertEquals(partial.status, "Partially Paid");
    const lastId = await f.payment({
      amount: 0,
      rate: 16001,
      invoiceId,
      sourceAmount: 0.01,
      appliedAmount: 0,
    });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: lastId });
    const final = await f.db.selectFrom("invoiceSettlement").select([
      "sourceAmount",
      "appliedAmount",
      "fxGainLossAmount",
    ]).where("paymentId", "=", lastId).executeTakeFirstOrThrow();
    assertEquals(final, {
      sourceAmount: 0.01,
      appliedAmount: 0,
      fxGainLossAmount: 0,
    });
    assertEquals(
      (await f.db.selectFrom("salesInvoices").select("status").where(
        "id",
        "=",
        invoiceId,
      ).executeTakeFirstOrThrow()).status,
      "Paid",
    );
  } finally {
    await f.cleanup();
  }
});
