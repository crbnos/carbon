// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "./payment-test-fixture";
import { postPaymentTransaction } from "./post-payment-transaction";

databaseTest(
  "independent concurrent invoice consumers cannot overspend one posted credit source",
  async () => {
    const f = await paymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const secondInvoiceId = await f.invoice();
      const sourceId = await f.payment({
        amount: 110,
        rate: 1,
        noApplication: true
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
      const firstId = await f.payment({ amount: 0, rate: 1.5 });
      const secondId = await f.payment({
        amount: 0,
        rate: 1.5,
        invoiceId: secondInvoiceId
      });
      const attempts = await Promise.allSettled([
        postPaymentTransaction(left, { ...f.args, paymentId: firstId }),
        postPaymentTransaction(right, { ...f.args, paymentId: secondId })
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled").length
      ).toEqual(1);
      const rejected = attempts.find(
        (attempt) => attempt.status === "rejected"
      );
      if (rejected?.status !== "rejected") {
        throw new Error("Expected exhausted source rejection");
      }
      expect(/fund|exceed|insufficient/i.test(String(rejected.reason))).toEqual(
        true
      );
      const posted = await f.db
        .selectFrom("payment")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("id", "in", [firstId, secondId])
        .where("status", "=", "Posted")
        .execute();
      expect(posted.length).toEqual(1);
      const consumption = await f.db
        .selectFrom("invoiceSettlement as s")
        .innerJoin("payment as p", "p.id", "s.paymentId")
        .select(["s.sourceAmount", "s.appliedAmount", "s.fxGainLossAmount"])
        .where("s.companyId", "=", f.companyId)
        .where("s.sourcePaymentId", "=", sourceId)
        .where("p.status", "=", "Posted")
        .execute();
      expect(
        consumption.reduce((sum, row) => sum + Number(row.sourceAmount), 0)
      ).toEqual(110);
      expect(
        consumption.reduce(
          (sum, row) =>
            sum + Number(row.appliedAmount) + Number(row.fxGainLossAmount),
          0
        )
      ).toEqual(110);
      const paymentJournals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Payment")
        .execute();
      expect(paymentJournals.length).toEqual(2);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "concurrent retries of one payment create exactly one journal and funding allocation",
  async () => {
    const f = await paymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const paymentId = await f.payment();
      const results = await Promise.all([
        postPaymentTransaction(left, { ...f.args, paymentId }),
        postPaymentTransaction(right, { ...f.args, paymentId })
      ]);
      expect(results[0].journalId).toEqual(results[1].journalId);
      expect(
        (
          await f.db
            .selectFrom("invoiceSettlement")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("paymentId", "=", paymentId)
            .execute()
        ).length
      ).toEqual(1);
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Payment")
            .execute()
        ).length
      ).toEqual(1);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);
