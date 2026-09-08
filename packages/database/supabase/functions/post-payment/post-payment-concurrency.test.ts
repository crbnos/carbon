import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { paymentFixture } from "./payment-test-fixture.ts";
import { postPaymentTransaction } from "./post-payment-transaction.ts";

Deno.test("independent concurrent invoice consumers cannot overspend one posted credit source", async () => {
  const f = await paymentFixture();
  const left = await f.connect();
  const right = await f.connect();
  try {
    const secondInvoiceId = await f.invoice();
    const sourceId = await f.payment({
      amount: 110,
      rate: 1,
      noApplication: true,
    });
    await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
    const firstId = await f.payment({ amount: 0, rate: 1.5 });
    const secondId = await f.payment({
      amount: 0,
      rate: 1.5,
      invoiceId: secondInvoiceId,
    });
    const attempts = await Promise.allSettled([
      postPaymentTransaction(left, { ...f.args, paymentId: firstId }),
      postPaymentTransaction(right, { ...f.args, paymentId: secondId }),
    ]);
    assertEquals(
      attempts.filter((attempt) => attempt.status === "fulfilled").length,
      1,
    );
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (rejected?.status !== "rejected") {
      throw new Error("Expected exhausted source rejection");
    }
    assertEquals(
      /fund|exceed|insufficient/i.test(String(rejected.reason)),
      true,
    );
    const posted = await f.db.selectFrom("payment").select("id").where(
      "companyId",
      "=",
      f.companyId,
    )
      .where("id", "in", [firstId, secondId]).where("status", "=", "Posted")
      .execute();
    assertEquals(posted.length, 1);
    const consumption = await f.db.selectFrom("invoiceSettlement as s")
      .innerJoin("payment as p", "p.id", "s.paymentId").select([
        "s.sourceAmount",
        "s.appliedAmount",
        "s.fxGainLossAmount",
      ])
      .where("s.companyId", "=", f.companyId).where(
        "s.sourcePaymentId",
        "=",
        sourceId,
      ).where("p.status", "=", "Posted").execute();
    assertEquals(
      consumption.reduce((sum, row) => sum + Number(row.sourceAmount), 0),
      110,
    );
    assertEquals(
      consumption.reduce(
        (sum, row) =>
          sum + Number(row.appliedAmount) + Number(row.fxGainLossAmount),
        0,
      ),
      110,
    );
    const paymentJournals = await f.db.selectFrom("journal").select("id").where(
      "companyId",
      "=",
      f.companyId,
    ).where("sourceType", "=", "Payment").execute();
    assertEquals(paymentJournals.length, 2);
  } finally {
    await left.destroy();
    await right.destroy();
    await f.cleanup();
  }
});

Deno.test("concurrent retries of one payment create exactly one journal and funding allocation", async () => {
  const f = await paymentFixture();
  const left = await f.connect();
  const right = await f.connect();
  try {
    const paymentId = await f.payment();
    const results = await Promise.all([
      postPaymentTransaction(left, { ...f.args, paymentId }),
      postPaymentTransaction(right, { ...f.args, paymentId }),
    ]);
    assertEquals(results[0].journalId, results[1].journalId);
    assertEquals(
      (await f.db.selectFrom("invoiceSettlement").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("paymentId", "=", paymentId).execute()).length,
      1,
    );
    assertEquals(
      (await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Payment").execute()).length,
      1,
    );
  } finally {
    await left.destroy();
    await right.destroy();
    await f.cleanup();
  }
});
