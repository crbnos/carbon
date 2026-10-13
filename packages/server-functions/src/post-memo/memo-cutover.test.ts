// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A memo around the accounting cutover: the Sales Returns default falls back
// to Sales before the cutover, and the void of a customer credit memo dated
// before the cutover that credits a contract or a rental agreement refuses.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "../post-payment/payment-test-fixture";
import { postMemoTransaction } from "./post-memo-transaction";
import { MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR } from "./rebuild-journal";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

/** A Draft customer credit memo of 55 EUR at 1.1 (50 base). */
async function creditMemo(
  f: Fixture,
  { id, salesReturnOrderId }: { id: string; salesReturnOrderId?: string }
): Promise<string> {
  const memoId = `${f.companyId}-${id}`;
  await f.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("accountDefault")
      .set({ salesDiscountAccount: f.account("discount") })
      .where("companyId", "=", f.companyId)
      .execute();
    // The memo names a return order this fixture has no reason to build.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("memo")
      .values({
        id: memoId,
        memoId: id.toUpperCase(),
        companyId: f.companyId,
        customerId: f.customerId,
        salesReturnOrderId,
        direction: "Credit",
        memoDate: "2026-09-07",
        currencyCode: "EUR",
        exchangeRate: 1.1,
        amount: 55,
        createdBy: "system"
      })
      .execute();
  });
  return memoId;
}

databaseTest(
  "before the cutover a return credit memo with no Sales Returns default books to Sales, with no stand-in",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: null })
        .where("id", "=", f.companyId)
        .execute();
      const memoId = await creditMemo(f, {
        id: "return-credit",
        salesReturnOrderId: `${f.companyId}-return-order`
      });
      const { journalId } = await postMemoTransaction(f.db, {
        ...f.args,
        memoId
      });

      const journal = await f.db
        .selectFrom("journal")
        .select(["status", "accountingPeriodId"])
        .where("id", "=", journalId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({
        status: "Provisional",
        accountingPeriodId: null
      });
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "accountDefaultRole"])
        .where("journalId", "=", journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("accountId")
        .execute();
      expect(lines).toEqual([
        {
          accountId: f.account("control"),
          amount: -50,
          accountDefaultRole: null
        },
        {
          accountId: f.account("sales"),
          amount: -50,
          accountDefaultRole: null
        }
      ]);
      const memo = await f.db
        .selectFrom("memo")
        .select("reasonAccount")
        .where("id", "=", memoId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(memo.reasonAccount).toEqual(f.account("sales"));
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the void of a credit memo dated before the cutover that credits a contract or a rental agreement refuses",
  async () => {
    const f = await paymentFixture();
    try {
      const contractMemo = await creditMemo(f, { id: "contract-credit" });
      const rentalMemo = await creditMemo(f, { id: "rental-credit" });
      for (const memoId of [contractMemo, rentalMemo]) {
        await postMemoTransaction(f.db, { ...f.args, memoId });
      }
      // The memos credit a contract and a rental agreement this fixture has
      // no reason to build. A posted memo refuses the change, so the trigger
      // is off for it.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await sql`UPDATE "memo" SET
            "customerContractId" = CASE WHEN "id" = ${contractMemo} THEN ${`${f.companyId}-contract`} END,
            "rentalAgreementId" = CASE WHEN "id" = ${rentalMemo} THEN ${`${f.companyId}-rental`} END
          WHERE "companyId" = ${f.companyId}
            AND "id" IN (${contractMemo}, ${rentalMemo})`.execute(trx);
      });
      // The cutover now falls after the memos' posting date.
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: "2026-09-10" })
        .where("id", "=", f.companyId)
        .execute();

      for (const memoId of [contractMemo, rentalMemo]) {
        await expect(
          postMemoTransaction(f.db, {
            ...f.args,
            today: "2026-09-12",
            type: "void",
            memoId
          })
        ).rejects.toThrow(MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR);
      }
      const memos = await f.db
        .selectFrom("memo")
        .select("status")
        .where("companyId", "=", f.companyId)
        .where("id", "in", [contractMemo, rentalMemo])
        .execute();
      expect(memos).toEqual([{ status: "Posted" }, { status: "Posted" }]);
    } finally {
      await f.cleanup();
    }
  }
);
