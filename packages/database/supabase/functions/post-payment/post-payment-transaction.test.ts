import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { databaseTest, paymentFixture } from "./payment-test-fixture.ts";
import { postPaymentTransaction } from "./post-payment-transaction.ts";

databaseTest("posting locks authoritative snapshots, overwrites forged rates, and is idempotent", async () => {
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

databaseTest("target over-consumption rolls back and leaves the payment draft unchanged", async () => {
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

databaseTest("prior credit is attributed to its original source and source void is blocked until consumer void", async () => {
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

databaseTest("a sequence fault after settlement replacement rolls the entire post back", async () => {
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

databaseTest("accounting-disabled posting still rejects an invalid bank account", async () => {
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

databaseTest("a wrong new-credit control account class cannot create an unbalanced stored ledger", async () => {
  const f = await paymentFixture();
  try {
    await f.db.updateTable("accountDefault").set({
      receivablesAccount: f.account("sales"),
    }).where("companyId", "=", f.companyId).execute();
    const paymentId = await f.payment({ amount: 165 });
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

databaseTest("positive document remainder with zero base carrying remains eligible until its final unit", async () => {
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

databaseTest("changed defaults preserve original invoice and prior-credit control accounts", async () => {
  const f = await paymentFixture();
  try {
    await f.db.insertInto("account").values(
      ["credit-control", "new-control"].map((name) => ({
        id: f.account(name),
        name,
        class: "Asset" as const,
        incomeBalance: "Balance Sheet" as const,
        companyGroupId: f.groupId,
        createdBy: "system",
      })),
    ).execute();
    await f.db.updateTable("accountDefault").set({
      receivablesAccount: f.account("credit-control"),
    }).where("companyId", "=", f.companyId).execute();
    const sourceId = await f.payment({ noApplication: true });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
    await f.db.updateTable("accountDefault").set({
      receivablesAccount: f.account("new-control"),
    }).where("companyId", "=", f.companyId).execute();
    const paymentId = await f.payment({ amount: 0 });
    const result = await postPaymentTransaction(f.db, { ...f.args, paymentId });
    const lines = await f.db.selectFrom("journalLine").select([
      "accountId",
      "amount",
      "description",
    ]).where("journalId", "=", result.journalId!).execute();
    assertEquals(
      lines.find((line) => line.description === "Accounts Receivable")
        ?.accountId,
      f.account("control"),
    );
    assertEquals(
      lines.find((line) =>
        line.description === "Accounts Receivable (credit applied)"
      )?.accountId,
      f.account("credit-control"),
    );
    assertEquals(
      lines.some((line) => line.accountId === f.account("new-control")),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

for (const isAR of [true, false]) {
  databaseTest(`${isAR ? "AR" : "AP"} mixed-sign original controls settle their net carrying without fictitious FX`, async () => {
    const f = await paymentFixture();
    try {
      const invoiceId = isAR ? f.invoiceId : `${f.companyId}-purchase`;
      const controlId = isAR ? f.account("control") : f.account("payable");
      const paymentId = await f.payment({
        amount: 90, rate: 1, sourceAmount: 90, appliedAmount: 90,
        noApplication: !isAR,
      });
      const journal = await f.db.selectFrom("journal").select([
        "id", "accountingPeriodId",
      ]).where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Sales Invoice").executeTakeFirstOrThrow();
      if (isAR) {
        await f.db.updateTable("salesInvoice").set({ exchangeRate: 1 })
          .where("id", "=", invoiceId).where("companyId", "=", f.companyId).execute();
        await f.db.insertInto("salesInvoiceLine").values({
          invoiceId, invoiceLineType: "Service", quantity: 1, unitPrice: -10,
          unitOfMeasureCode: "EA", companyId: f.companyId, createdBy: "system",
        }).execute();
      } else {
        const supplier = await f.db.insertInto("supplier").values({
          name: "Mixed-sign supplier", companyId: f.companyId,
        }).returning("id").executeTakeFirstOrThrow();
        const interaction = await f.db.insertInto("supplierInteraction").values({
          supplierId: supplier.id, companyId: f.companyId,
        }).returning("id").executeTakeFirstOrThrow();
        await f.db.insertInto("account").values({
          id: controlId, name: "Mixed-sign AP", class: "Liability",
          incomeBalance: "Balance Sheet", companyGroupId: f.groupId, createdBy: "system",
        }).execute();
        await f.db.updateTable("accountDefault").set({
          payablesAccount: controlId, supplierPaymentDiscountAccount: f.account("discount"),
          supplierWriteOffAccount: f.account("sales"),
        }).where("companyId", "=", f.companyId).execute();
        await f.db.insertInto("purchaseInvoice").values({
          id: invoiceId, invoiceId, supplierId: supplier.id,
          supplierInteractionId: interaction.id, currencyCode: "EUR", exchangeRate: 1,
          status: "Open", companyId: f.companyId, createdBy: "system",
        }).execute();
        await f.db.insertInto("purchaseInvoiceLine").values([100, -10].map((amount) => ({
          invoiceId, invoiceLineType: "G/L Account" as const, quantity: 1,
          supplierUnitPrice: amount, exchangeRate: 1, accountId: f.account("loss"),
          companyId: f.companyId, createdBy: "system",
        }))).execute();
        await f.db.updateTable("payment").set({
          paymentType: "Disbursement", customerId: null, supplierId: supplier.id,
        }).where("id", "=", paymentId).where("companyId", "=", f.companyId).execute();
        await f.db.insertInto("invoiceSettlement").values({
          paymentId, targetPurchaseInvoiceId: invoiceId, sourceAmount: 90, appliedAmount: 90,
          sourceExchangeRate: 1, targetExchangeRate: 1,
          appliedDate: "2026-09-07", companyId: f.companyId, createdBy: "system",
        }).execute();
      }
      const extraJournal = await f.db.insertInto("journal").values({
        journalEntryId: `${invoiceId}-adjustment`, accountingPeriodId: journal.accountingPeriodId,
        companyId: f.companyId, sourceType: isAR ? "Sales Invoice" : "Purchase Invoice",
        status: "Posted", postingDate: "2026-09-01", createdBy: "system",
      }).returning("id").executeTakeFirstOrThrow();
      await f.db.insertInto("journalLine").values((isAR ? [-10] : [100, -10]).flatMap((amount) => [
        { accountId: controlId, description: isAR ? "Accounts Receivable" : "Accounts Payable" },
        { accountId: isAR ? f.account("sales") : f.account("loss"), description: "Invoice offset" },
      ].map((line) => ({
        ...line, amount, quantity: 1, journalId: extraJournal.id, documentId: invoiceId,
        documentType: "Invoice" as const, journalLineReference: invoiceId, companyId: f.companyId,
      })))).execute();
      const result = await postPaymentTransaction(f.db, { ...f.args, paymentId });
      const settlement = await f.db.selectFrom("invoiceSettlement").select([
        "sourceAmount", "appliedAmount", "fxGainLossAmount",
      ]).where("paymentId", "=", paymentId).where("companyId", "=", f.companyId).executeTakeFirstOrThrow();
      assertEquals(settlement, { sourceAmount: 90, appliedAmount: 90, fxGainLossAmount: 0 });
      const paymentLines = await f.db.selectFrom("journalLine").select(["amount", "accountId"])
        .where("journalId", "=", result.journalId!).where("companyId", "=", f.companyId).execute();
      assertEquals(paymentLines.filter((line) => line.accountId === controlId).reduce((sum, line) => sum + Number(line.amount), 90), 0);
    } finally {
      await f.cleanup();
    }
  });
}

databaseTest("intercompany invoice settlement retains its original control after defaults change", async () => {
  const f = await paymentFixture();
  try {
    const invoiceId = await f.invoice({ controlDescription: "IC Receivables" });
    await f.db.updateTable("accountDefault").set({ receivablesAccount: f.account("bank") }).where("companyId", "=", f.companyId).execute();
    const paymentId = await f.payment({ invoiceId });
    const posted = await postPaymentTransaction(f.db, { ...f.args, paymentId });
    const lines = await f.db.selectFrom("journalLine").select(["accountId", "amount"]).where("journalId", "=", posted.journalId!).execute();
    assertEquals(lines.find((line) => line.accountId === f.account("control"))?.amount, -100);
  } finally { await f.cleanup(); }
});
