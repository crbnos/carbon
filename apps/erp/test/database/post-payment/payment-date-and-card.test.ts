// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import { postPaymentTransaction } from "../../../app/modules/invoicing/invoicing.service";

// The fixture's payment is dated 2026-09-01 and posted on 2026-09-07.
databaseTest("a payment posts on its payment date", async () => {
  const f = await paymentFixture();
  try {
    const paymentId = await f.payment();
    const { journalId } = await postPaymentTransaction(f.db, {
      ...f.args,
      paymentId
    });
    const journal = await f.db
      .selectFrom("journal")
      .select(sql<string>`"postingDate"::text`.as("postingDate"))
      .where("id", "=", journalId!)
      .executeTakeFirstOrThrow();
    expect(journal.postingDate).toEqual("2026-09-01");
    const payment = await f.db
      .selectFrom("payment")
      .select("postingDate")
      .where("id", "=", paymentId)
      .executeTakeFirstOrThrow();
    expect(payment.postingDate).toEqual("2026-09-01");
    const settlement = await f.db
      .selectFrom("invoiceSettlement")
      .select("appliedDate")
      .where("paymentId", "=", paymentId)
      .executeTakeFirstOrThrow();
    expect(settlement.appliedDate).toEqual("2026-09-01");
  } finally {
    await f.cleanup();
  }
});

for (const closeStatus of ["Closed", "Locked"] as const) {
  databaseTest(
    `a payment dated in a ${closeStatus.toLowerCase()} period is refused by the period's name`,
    async () => {
      const f = await paymentFixture();
      try {
        await f.db
          .updateTable("accountingPeriod")
          .set({ closeStatus })
          .where("companyId", "=", f.companyId)
          .execute();
        const paymentId = await f.payment();
        await expect(
          postPaymentTransaction(f.db, { ...f.args, paymentId })
        ).rejects.toThrow(
          `2026-09-01 is in the September 2026 accounting period, which is ${closeStatus.toLowerCase()}. Reopen it or change the payment date.`
        );
        const payment = await f.db
          .selectFrom("payment")
          .select(["status", "journalId"])
          .where("id", "=", paymentId)
          .executeTakeFirstOrThrow();
        expect(payment).toEqual({ status: "Draft", journalId: null });
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "a payment dated before the accounting cutover is refused",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: "2026-09-05" })
        .where("id", "=", f.companyId)
        .execute();
      const paymentId = await f.payment();
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("is before your accounting cutover on 2026-09-05");
    } finally {
      await f.cleanup();
    }
  }
);

/** A Credit Card account, and an on-account supplier payment paid from it. */
async function cardPayment(
  f: Awaited<ReturnType<typeof paymentFixture>>,
  party: "supplier" | "customer"
) {
  const card = f.account("card");
  const supplierId = `${f.companyId}-supplier`;
  const paymentId = `${f.companyId}-card-payment`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values({
        id: card,
        name: "card",
        class: "Liability",
        accountType: "Credit Card",
        incomeBalance: "Balance Sheet",
        companyGroupId: f.groupId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("supplier")
      .values({ id: supplierId, name: supplierId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId,
        paymentType: party === "supplier" ? "Disbursement" : "Receipt",
        supplierId: party === "supplier" ? supplierId : null,
        customerId: party === "customer" ? f.customerId : null,
        paymentDate: "2026-09-01",
        currencyCode: "USD",
        totalAmount: 100,
        exchangeRate: 1,
        bankAccount: card,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
  });
  return { card, paymentId };
}

databaseTest(
  "a supplier payment by credit card credits the card liability",
  async () => {
    const f = await paymentFixture();
    try {
      const { card, paymentId } = await cardPayment(f, "supplier");
      const { journalId } = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", journalId!)
        .execute();
      // Natural-signed: a credit to a liability is positive, a debit negative.
      expect(lines.find((line) => line.accountId === card)?.amount).toEqual(
        100
      );
      expect(
        lines.find((line) => line.accountId === f.account("employee-payable"))
          ?.amount
      ).toEqual(-100);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a customer receipt cannot use a credit card", async () => {
  const f = await paymentFixture();
  try {
    const { paymentId } = await cardPayment(f, "customer");
    await expect(
      postPaymentTransaction(f.db, { ...f.args, paymentId })
    ).rejects.toThrow(
      "Pay from an active Asset account, such as a bank or cash account"
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a supplier payment cannot use a liability that is not a credit card",
  async () => {
    const f = await paymentFixture();
    try {
      const { card, paymentId } = await cardPayment(f, "supplier");
      await f.db
        .updateTable("account")
        .set({ accountType: "Other Current Liability" })
        .where("id", "=", card)
        .execute();
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow("or a Credit Card account");
    } finally {
      await f.cleanup();
    }
  }
);
