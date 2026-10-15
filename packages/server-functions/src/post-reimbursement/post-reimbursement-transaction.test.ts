// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { reimbursementFixture } from "./post-reimbursement-test-fixture";
import { postReimbursementTransaction } from "./post-reimbursement-transaction";

type Fixture = Awaited<ReturnType<typeof reimbursementFixture>>;

// The one assertion that matters most: the entry the GL actually stored
// balances. `journalEntries` derives totalDebits/totalCredits from account
// class AND amount sign (lessons.md), so this proves the natural-balance signs
// are right — not merely that the numbers add up.
async function assertBalancedJournal(f: Fixture, journalId: string | null) {
  const entry = await f.db
    .selectFrom("journalEntries")
    .select(["totalDebits", "totalCredits", "sourceType"])
    .where("id", "=", journalId!)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  expect(entry.sourceType).toEqual("Reimbursement");
  expect(Number(entry.totalDebits)).toEqual(Number(entry.totalCredits));
  return entry;
}

function lineByAccount(
  lines: { accountId: string | null; amount: number | string }[],
  accountId: string | null
) {
  const found = lines.find((line) => line.accountId === accountId);
  if (!found) throw new Error(`No journal line for ${accountId}`);
  return Number(found.amount);
}

async function journalLines(f: Fixture, journalId: string | null) {
  return await f.db
    .selectFrom("journalLine")
    .select([
      "id",
      "accountId",
      "amount",
      "description",
      "documentType",
      "documentId"
    ])
    .where("journalId", "=", journalId)
    .where("companyId", "=", f.companyId)
    .orderBy("id")
    .execute();
}

// ---------------------------------------------------------------------------
// AC1 — coding lines debited, employee payable credited, header flipped.
// ---------------------------------------------------------------------------

databaseTest(
  "posting debits each coding line and credits the employee payable",
  async () => {
    const f = await reimbursementFixture();
    try {
      const result = await postReimbursementTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();

      const journals = await f.db
        .selectFrom("journal")
        .select(["id"])
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Reimbursement")
        .execute();
      expect(journals.length).toEqual(1);

      const lines = await journalLines(f, result.journalId);
      expect(lines.length).toEqual(3);
      expect(lineByAccount(lines, f.account("expense"))).toEqual(500);
      expect(lineByAccount(lines, f.account("expense2"))).toEqual(120);
      // A POSITIVE amount on a Liability account is a CREDIT.
      expect(lineByAccount(lines, f.account("payable"))).toEqual(620);
      expect(
        lines.every(
          (line) =>
            line.documentType === "Reimbursement" &&
            line.documentId === f.reimbursementId
        )
      ).toEqual(true);
      await assertBalancedJournal(f, result.journalId);

      const header = await f.db
        .selectFrom("reimbursement")
        .select([
          "status",
          "journalId",
          "payableAccountId",
          "postedBy",
          "postedAt"
        ])
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header.status).toEqual("Posted");
      expect(header.journalId).toEqual(result.journalId);
      expect(header.payableAccountId).toEqual(f.account("payable"));
      expect(header.postedBy).toEqual("system");
      expect(header.postedAt !== null).toEqual(true);

      // Re-posting returns the stored journal id and writes nothing new.
      const second = await postReimbursementTransaction(f.db, f.args);
      expect(second).toEqual(result);
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Reimbursement")
            .execute()
        ).length
      ).toEqual(1);
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// AC2 — the AP trade fallback, and the refusal when neither default is set.
// ---------------------------------------------------------------------------

databaseTest(
  "an unset employee payable default falls back to the AP trade account",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          employeeReimbursementsPayableAccount: null
        })
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await postReimbursementTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();
      const lines = await journalLines(f, result.journalId);
      expect(lines.length).toEqual(3);
      expect(lineByAccount(lines, f.account("ap"))).toEqual(620);
      await assertBalancedJournal(f, result.journalId);

      const header = await f.db
        .selectFrom("reimbursement")
        .select("payableAccountId")
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header.payableAccountId).toEqual(f.account("ap"));
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting refuses when neither payable default is configured",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .deleteFrom("accountDefault")
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(
        (() => postReimbursementTransaction(f.db, f.args))()
      ).rejects.toThrow("No employee reimbursements payable account");
      expect(
        (
          await f.db
            .selectFrom("reimbursement")
            .select("status")
            .where("id", "=", f.reimbursementId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting refuses a payable account that is not a Liability",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .updateTable("account")
        .set({ class: "Asset" })
        .where("id", "=", f.account("payable"))
        .execute();
      await expect(
        (() => postReimbursementTransaction(f.db, f.args))()
      ).rejects.toThrow("must be a Liability account");
      expect(
        (
          await f.db
            .selectFrom("reimbursement")
            .select("status")
            .where("id", "=", f.reimbursementId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// AC3 — legacy cost-center coding becomes a journalLineDimension row.
// ---------------------------------------------------------------------------

databaseTest(
  "a legacy costCenterId writes one dimension row on its own line",
  async () => {
    const f = await reimbursementFixture();
    try {
      const result = await postReimbursementTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();
      const lines = await journalLines(f, result.journalId);
      const expenseLine = lines.find(
        (line) => line.accountId === f.account("expense")
      );
      expect(expenseLine).toBeDefined();

      const dimensions = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "dimensionId", "valueId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(dimensions).toEqual([
        {
          journalLineId: expenseLine!.id,
          dimensionId: f.costCenterDimensionId,
          valueId: f.costCenterId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting refuses cost-center coding with no active Cost Center dimension",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .updateTable("dimension")
        .set({ active: false })
        .where("id", "=", f.costCenterDimensionId)
        .execute();
      await expect(
        (() => postReimbursementTransaction(f.db, f.args))()
      ).rejects.toThrow("Company group has no active Cost Center dimension");
      expect(
        (
          await f.db
            .selectFrom("reimbursement")
            .select("status")
            .where("id", "=", f.reimbursementId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// The dimension union — the generic table wins a same-dimension conflict.
// ---------------------------------------------------------------------------

databaseTest(
  "generic line dimensions win over the legacy columns and union with them",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .insertInto("reimbursementLineDimension")
        .values([
          // Same dimension the legacy costCenterId names, different value: the
          // human's edit must win over what the sync wrote.
          {
            id: `${f.lineId}-generic-cc`,
            reimbursementLineId: f.lineId,
            dimensionId: f.costCenterDimensionId,
            valueId: f.otherCostCenterId,
            companyId: f.companyId
          },
          // A dimension with no legacy counterpart at all.
          {
            id: `${f.secondLineId}-generic-pj`,
            reimbursementLineId: f.secondLineId,
            dimensionId: f.projectDimensionId,
            valueId: f.projectId,
            companyId: f.companyId
          }
        ])
        .execute();

      const result = await postReimbursementTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();
      const lines = await journalLines(f, result.journalId);
      const expenseLine = lines.find(
        (line) => line.accountId === f.account("expense")
      );
      const meals = lines.find(
        (line) => line.accountId === f.account("expense2")
      );
      expect(expenseLine).toBeDefined();
      expect(meals).toBeDefined();

      const dimensions = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "dimensionId", "valueId"])
        .where("companyId", "=", f.companyId)
        .execute();

      // Exactly ONE row for the conflicted dimension, carrying the generic
      // value — not two, and not the legacy value.
      const onExpense = dimensions.filter(
        (d) => d.journalLineId === expenseLine!.id
      );
      expect(onExpense).toEqual([
        {
          journalLineId: expenseLine!.id,
          dimensionId: f.costCenterDimensionId,
          valueId: f.otherCostCenterId
        }
      ]);
      expect(dimensions.filter((d) => d.journalLineId === meals!.id)).toEqual([
        {
          journalLineId: meals!.id,
          dimensionId: f.projectDimensionId,
          valueId: f.projectId
        }
      ]);
      expect(dimensions.length).toEqual(2);
      // The payable control leg never carries line coding.
      const payable = lines.find(
        (line) => line.accountId === f.account("payable")
      );
      expect(payable).toBeDefined();
      expect(dimensions.some((d) => d.journalLineId === payable!.id)).toEqual(
        false
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting refuses a generic line dimension that is not active",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .insertInto("reimbursementLineDimension")
        .values({
          id: `${f.secondLineId}-generic-pj`,
          reimbursementLineId: f.secondLineId,
          dimensionId: f.projectDimensionId,
          valueId: f.projectId,
          companyId: f.companyId
        })
        .execute();
      await f.db
        .updateTable("dimension")
        .set({ active: false })
        .where("id", "=", f.projectDimensionId)
        .execute();

      await expect(
        (() => postReimbursementTransaction(f.db, f.args))()
      ).rejects.toThrow("not an active dimension in this company group");
      expect(
        (
          await f.db
            .selectFrom("reimbursement")
            .select("status")
            .where("id", "=", f.reimbursementId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// AC4 — void writes a mirror reversal, copies dimensions, and is idempotent.
// ---------------------------------------------------------------------------

databaseTest(
  "void reverses the journal exactly once and copies its dimensions",
  async () => {
    const f = await reimbursementFixture();
    try {
      const posted = await postReimbursementTransaction(f.db, f.args);
      expect(posted.journalId).toBeDefined();
      const originalLines = await journalLines(f, posted.journalId);

      const voidArgs = { ...f.args, type: "void" as const };
      const voided = await postReimbursementTransaction(f.db, voidArgs);
      // Void leaves the header pointing at the ORIGINAL journal.
      expect(voided.journalId).toEqual(posted.journalId);

      const journals = await f.db
        .selectFrom("journal")
        .select(["id", "description"])
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Reimbursement")
        .execute();
      expect(journals.length).toEqual(2);
      const reversal = journals.find((j) => j.id !== posted.journalId);
      expect(reversal).toBeDefined();
      expect(reversal!.description!.startsWith("VOID Reimbursement")).toEqual(
        true
      );

      const reversalLines = await journalLines(f, reversal!.id);
      expect(reversalLines.length).toEqual(originalLines.length);
      for (const original of originalLines) {
        expect(lineByAccount(reversalLines, original.accountId)).toEqual(
          -Number(original.amount)
        );
      }
      await assertBalancedJournal(f, reversal!.id);

      // The cost-center dimension is carried onto the reversing line.
      const dimensions = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "dimensionId", "valueId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(dimensions.length).toEqual(2);
      expect(
        dimensions.every(
          (d) =>
            d.dimensionId === f.costCenterDimensionId &&
            d.valueId === f.costCenterId
        )
      ).toEqual(true);
      const reversalLineIds = new Set(reversalLines.map((line) => line.id));
      expect(
        dimensions.filter((d) => reversalLineIds.has(d.journalLineId)).length
      ).toEqual(1);

      const header = await f.db
        .selectFrom("reimbursement")
        .select(["status", "journalId", "voidedBy"])
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header.status).toEqual("Voided");
      expect(header.journalId).toEqual(posted.journalId);
      expect(header.voidedBy).toEqual("system");

      // Re-voiding returns the stored journal id without a second reversal.
      const again = await postReimbursementTransaction(f.db, voidArgs);
      expect(again).toEqual(voided);
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Reimbursement")
            .execute()
        ).length
      ).toEqual(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Voided reimbursement cannot be posted", async () => {
  const f = await reimbursementFixture();
  try {
    await postReimbursementTransaction(f.db, f.args);
    await postReimbursementTransaction(f.db, { ...f.args, type: "void" });
    await expect(
      (() => postReimbursementTransaction(f.db, f.args))()
    ).rejects.toThrow("Cannot post reimbursement in status Voided");
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tenancy — the record id from the URL is re-read under companyId.
// ---------------------------------------------------------------------------

databaseTest(
  "a reimbursement belonging to another company is not found",
  async () => {
    const reimbursementId = `shared-${crypto.randomUUID()}`;
    const left = await reimbursementFixture({ reimbursementId });
    const right = await reimbursementFixture({ reimbursementId });
    try {
      // The record id comes straight off a URL, so the id alone proves nothing
      // — the read is scoped to companyId and a company that does not hold the
      // row simply does not find it.
      await expect(
        (() =>
          postReimbursementTransaction(left.db, {
            ...left.args,
            companyId: `${left.companyId}-does-not-exist`
          }))()
      ).rejects.toThrow("Reimbursement not found");
      // Two companies holding the SAME id: posting the right one leaves the
      // left one untouched.
      await postReimbursementTransaction(right.db, right.args);
      expect(
        await left.db
          .selectFrom("reimbursement")
          .select(["status", "journalId"])
          .where("id", "=", reimbursementId)
          .where("companyId", "=", left.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft", journalId: null });
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// The subledger must equal the header.
// ---------------------------------------------------------------------------

databaseTest(
  "coding lines that do not sum to the header refuse to post",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .updateTable("reimbursementLine")
        .set({ amount: 100 })
        .where("id", "=", f.secondLineId)
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(
        (() => postReimbursementTransaction(f.db, f.args))()
      ).rejects.toThrow("does not equal header amount");
      expect(
        (
          await f.db
            .selectFrom("reimbursement")
            .select("status")
            .where("id", "=", f.reimbursementId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
      expect(
        await f.db
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Reimbursement")
          .execute()
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// A paid-out reimbursement cannot be voided.
// ---------------------------------------------------------------------------

databaseTest(
  "void refuses a reimbursement that a posted payment has already settled",
  async () => {
    const f = await reimbursementFixture();
    try {
      const posted = await postReimbursementTransaction(f.db, f.args);
      expect(posted.journalId).toBeDefined();

      // The payout: a Posted payment plus the settlement that consumes the
      // reimbursement. `post-memo` refuses the same shape ("Cannot void a
      // consumed memo"); without the counterpart guard this void wrote a second
      // journal crediting the employee payable again, leaving that account
      // negative with nothing to clear it and the cash already gone.
      const paymentId = `${f.reimbursementId}-payout`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("payment")
          .values({
            id: paymentId,
            paymentId: `PAY-${paymentId}`,
            paymentType: "Disbursement",
            paymentDate: "2026-09-28",
            currencyCode: "USD",
            totalAmount: 100,
            bankAccount: f.account("misc"),
            status: "Posted",
            employeeId: f.employeeId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("invoiceSettlement")
          .values({
            paymentId,
            targetReimbursementId: f.reimbursementId,
            appliedAmount: 100,
            sourceExchangeRate: 1,
            targetExchangeRate: 1,
            appliedDate: "2026-09-28",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      await expect(
        (() =>
          postReimbursementTransaction(f.db, { ...f.args, type: "void" }))()
      ).rejects.toThrow("Cannot void a paid reimbursement");

      // And the refusal left no reversal behind.
      const journals = await f.db
        .selectFrom("journal")
        .select(["id"])
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Reimbursement")
        .execute();
      expect(journals.length).toEqual(1);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "before the cutover a reimbursement posts and voids Provisional journals with no period",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: null })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .deleteFrom("accountingPeriod")
        .where("companyId", "=", f.companyId)
        .execute();

      const posted = await postReimbursementTransaction(f.db, f.args);
      const voided = await postReimbursementTransaction(f.db, {
        ...f.args,
        type: "void"
      });
      expect(voided.journalId).toEqual(posted.journalId);

      const journals = await f.db
        .selectFrom("journal")
        .select(["status", "accountingPeriodId", "description"])
        .where("companyId", "=", f.companyId)
        .orderBy("journalEntryId")
        .execute();
      expect(journals.length).toEqual(2);
      expect(
        journals.every(
          (journal) =>
            journal.status === "Provisional" &&
            journal.accountingPeriodId === null
        )
      ).toEqual(true);
      expect(journals[1]?.description?.startsWith("VOID")).toEqual(true);

      const periods = await f.db
        .selectFrom("accountingPeriod")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(periods.length).toEqual(0);

      const header = await f.db
        .selectFrom("reimbursement")
        .select(["status", "journalId"])
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({ status: "Voided", journalId: posted.journalId });
    } finally {
      await f.cleanup();
    }
  }
);
