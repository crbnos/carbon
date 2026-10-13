// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The void of a payment dated before the cutover builds the payment's
// journal again. The processor fee the payment withheld is not stored on it:
// the rebuild reads it from the payment's integration mapping, as the
// posting received it, else off the payment's own journal.

import { MISSING_PROCESSOR_FEE_ACCOUNT_ERROR } from "@carbon/database/payment-processor-fee";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "./payment-test-fixture";
import { postPaymentTransaction } from "./post-payment-transaction";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

const FEE_DESCRIPTION = "Stripe processing fee — in_test";

/**
 * A payment of 165 EUR at 1.1 (150 base), posted on 2026-09-07 with a 2.2 EUR
 * fee (2 base) on `feeAccount`, as `recordStripeConnectPayment` posts it.
 * With `mapping`, the payment's Stripe Connect mapping records the fee.
 */
async function postWithFee(
  f: Fixture,
  { mapping }: { mapping: boolean }
): Promise<{ paymentId: string; feeAccount: string }> {
  const feeAccount = f.account("fee");
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values({
        id: feeAccount,
        name: "fee",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: f.groupId,
        createdBy: "system"
      })
      .execute();
  });
  const paymentId = await f.payment({ amount: 165 });
  if (mapping) {
    await f.db
      .insertInto("externalIntegrationMapping")
      .values({
        companyId: f.companyId,
        integration: "stripe-connect",
        entityType: "payment",
        entityId: paymentId,
        externalId: "in_test",
        metadata: { feeAmount: 2.2, feeCurrency: "EUR" }
      })
      .execute();
  }
  await postPaymentTransaction(f.db, {
    ...f.args,
    paymentId,
    fee: { amount: 2.2, accountId: feeAccount, description: FEE_DESCRIPTION }
  });
  return { paymentId, feeAccount };
}

/** Moves the cutover past the payment's posting date, so its void builds the
 *  journal again. */
async function cutOverAfterPosting(f: Fixture) {
  await f.db
    .updateTable("companySettings")
    .set({ accountingCutoverDate: "2026-09-10" })
    .where("id", "=", f.companyId)
    .execute();
}

async function voidLines(f: Fixture, paymentId: string) {
  const { journalId } = await postPaymentTransaction(f.db, {
    ...f.args,
    today: "2026-09-12",
    type: "void",
    paymentId
  });
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount", "description"])
    .where("companyId", "=", f.companyId)
    .where("journalId", "=", journalId!)
    .execute();
  return lines
    .map((line) => ({ ...line, amount: Number(line.amount) }))
    .sort((a, b) => (a.description ?? "").localeCompare(b.description ?? ""));
}

databaseTest(
  "the void of a payment before the cutover books the processor fee its mapping records",
  async () => {
    const f = await paymentFixture();
    try {
      const { paymentId, feeAccount } = await postWithFee(f, { mapping: true });
      // The integration names its own fee account.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .insertInto("companyIntegration")
          .values({
            id: "stripe-connect",
            companyId: f.companyId,
            metadata: { paymentFeeAccount: feeAccount }
          })
          .execute();
        // The reset nulled the journal of a payment dated before the cutover,
        // so nothing can be read off it.
        await trx
          .updateTable("payment")
          .set({ journalId: null })
          .where("id", "=", paymentId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await cutOverAfterPosting(f);

      expect(await voidLines(f, paymentId)).toEqual([
        {
          accountId: f.account("control"),
          amount: 100,
          description: "VOID: Accounts Receivable"
        },
        {
          accountId: f.account("control"),
          amount: 50,
          description: "VOID: Accounts Receivable (on-account credit)"
        },
        {
          accountId: f.account("bank"),
          amount: -148,
          description: "VOID: Bank / Cash"
        },
        {
          accountId: feeAccount,
          amount: -2,
          description: `VOID: ${FEE_DESCRIPTION}`
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the void of a payment before the cutover refuses a mapped fee with no account to take it",
  async () => {
    const f = await paymentFixture();
    try {
      const { paymentId } = await postWithFee(f, { mapping: true });
      await cutOverAfterPosting(f);
      // No integration fee account, and no service charge default.
      await f.db
        .deleteFrom("accountDefault")
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(
        postPaymentTransaction(f.db, {
          ...f.args,
          today: "2026-09-12",
          type: "void",
          paymentId
        })
      ).rejects.toThrow(MISSING_PROCESSOR_FEE_ACCOUNT_ERROR);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the void of a payment before the cutover with no mapping reads the fee off its journal",
  async () => {
    const f = await paymentFixture();
    try {
      const { paymentId, feeAccount } = await postWithFee(f, {
        mapping: false
      });
      await cutOverAfterPosting(f);
      const lines = await voidLines(f, paymentId);
      expect(lines.find((line) => line.accountId === feeAccount)).toEqual({
        accountId: feeAccount,
        amount: -2,
        description: `VOID: ${FEE_DESCRIPTION}`
      });
      expect(
        lines.find((line) => line.accountId === f.account("bank"))?.amount
      ).toEqual(-148);
    } finally {
      await f.cleanup();
    }
  }
);
