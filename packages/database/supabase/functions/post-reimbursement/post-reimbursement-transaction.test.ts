import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  databaseTest,
  reimbursementFixture,
} from "./post-reimbursement-test-fixture.ts";
import { postReimbursementTransaction } from "./post-reimbursement-transaction.ts";

type Fixture = Awaited<ReturnType<typeof reimbursementFixture>>;

// The one assertion that matters most: the entry the GL actually stored
// balances. `journalEntries` derives totalDebits/totalCredits from account
// class AND amount sign (lessons.md), so this proves the natural-balance signs
// are right — not merely that the numbers add up.
async function assertBalancedJournal(f: Fixture, journalId: string) {
  const entry = await f.db.selectFrom("journalEntries").select([
    "totalDebits",
    "totalCredits",
    "sourceType",
  ]).where("id", "=", journalId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  assertEquals(entry.sourceType, "Reimbursement");
  assertEquals(Number(entry.totalDebits), Number(entry.totalCredits));
  return entry;
}

function lineByAccount(
  lines: { accountId: string; amount: number | string }[],
  accountId: string,
) {
  const found = lines.find((line) => line.accountId === accountId);
  if (!found) throw new Error(`No journal line for ${accountId}`);
  return Number(found.amount);
}

async function journalLines(f: Fixture, journalId: string) {
  return await f.db.selectFrom("journalLine").select([
    "id",
    "accountId",
    "amount",
    "description",
    "documentType",
    "documentId",
  ]).where("journalId", "=", journalId)
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
      assertExists(result.journalId);

      const journals = await f.db.selectFrom("journal").select(["id"])
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Reimbursement")
        .execute();
      assertEquals(journals.length, 1);

      const lines = await journalLines(f, result.journalId);
      assertEquals(lines.length, 3);
      assertEquals(lineByAccount(lines, f.account("expense")), 500);
      assertEquals(lineByAccount(lines, f.account("expense2")), 120);
      // A POSITIVE amount on a Liability account is a CREDIT.
      assertEquals(lineByAccount(lines, f.account("payable")), 620);
      assertEquals(
        lines.every((line) =>
          line.documentType === "Reimbursement" &&
          line.documentId === f.reimbursementId
        ),
        true,
      );
      await assertBalancedJournal(f, result.journalId);

      const header = await f.db.selectFrom("reimbursement").select([
        "status",
        "journalId",
        "payableAccountId",
        "postedBy",
        "postedAt",
      ]).where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      assertEquals(header.status, "Posted");
      assertEquals(header.journalId, result.journalId);
      assertEquals(header.payableAccountId, f.account("payable"));
      assertEquals(header.postedBy, "system");
      assertEquals(header.postedAt !== null, true);

      // Re-posting returns the stored journal id and writes nothing new.
      const second = await postReimbursementTransaction(f.db, f.args);
      assertEquals(second, result);
      assertEquals(
        (await f.db.selectFrom("journal").select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Reimbursement").execute()).length,
        1,
      );
    } finally {
      await f.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC2 — the AP trade fallback, and the refusal when neither default is set.
// ---------------------------------------------------------------------------

databaseTest(
  "an unset employee payable default falls back to the AP trade account",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.updateTable("accountDefault").set({
        employeeReimbursementsPayableAccount: null,
      }).where("companyId", "=", f.companyId).execute();

      const result = await postReimbursementTransaction(f.db, f.args);
      assertExists(result.journalId);
      const lines = await journalLines(f, result.journalId);
      assertEquals(lines.length, 3);
      assertEquals(lineByAccount(lines, f.account("ap")), 620);
      await assertBalancedJournal(f, result.journalId);

      const header = await f.db.selectFrom("reimbursement").select(
        "payableAccountId",
      ).where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      assertEquals(header.payableAccountId, f.account("ap"));
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting refuses when neither payable default is configured",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.deleteFrom("accountDefault").where(
        "companyId",
        "=",
        f.companyId,
      ).execute();
      await assertRejects(
        () => postReimbursementTransaction(f.db, f.args),
        Error,
        "No employee reimbursements payable account",
      );
      assertEquals(
        (await f.db.selectFrom("reimbursement").select("status")
          .where("id", "=", f.reimbursementId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()).status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting refuses a payable account that is not a Liability",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.updateTable("account").set({ class: "Asset" })
        .where("id", "=", f.account("payable")).execute();
      await assertRejects(
        () => postReimbursementTransaction(f.db, f.args),
        Error,
        "must be a Liability account",
      );
      assertEquals(
        (await f.db.selectFrom("reimbursement").select("status")
          .where("id", "=", f.reimbursementId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()).status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
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
      assertExists(result.journalId);
      const lines = await journalLines(f, result.journalId);
      const expenseLine = lines.find((line) =>
        line.accountId === f.account("expense")
      );
      assertExists(expenseLine);

      const dimensions = await f.db.selectFrom("journalLineDimension").select([
        "journalLineId",
        "dimensionId",
        "valueId",
      ]).where("companyId", "=", f.companyId).execute();
      assertEquals(dimensions, [{
        journalLineId: expenseLine.id,
        dimensionId: f.costCenterDimensionId,
        valueId: f.costCenterId,
      }]);
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting refuses cost-center coding with no active Cost Center dimension",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.updateTable("dimension").set({ active: false })
        .where("id", "=", f.costCenterDimensionId).execute();
      await assertRejects(
        () => postReimbursementTransaction(f.db, f.args),
        Error,
        "Company group has no active Cost Center dimension",
      );
      assertEquals(
        (await f.db.selectFrom("reimbursement").select("status")
          .where("id", "=", f.reimbursementId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()).status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// The dimension union — the generic table wins a same-dimension conflict.
// ---------------------------------------------------------------------------

databaseTest(
  "generic line dimensions win over the legacy columns and union with them",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.insertInto("reimbursementLineDimension").values([
        // Same dimension the legacy costCenterId names, different value: the
        // human's edit must win over what the sync wrote.
        {
          id: `${f.lineId}-generic-cc`,
          reimbursementLineId: f.lineId,
          dimensionId: f.costCenterDimensionId,
          valueId: f.otherCostCenterId,
          companyId: f.companyId,
        },
        // A dimension with no legacy counterpart at all.
        {
          id: `${f.secondLineId}-generic-pj`,
          reimbursementLineId: f.secondLineId,
          dimensionId: f.projectDimensionId,
          valueId: f.projectId,
          companyId: f.companyId,
        },
      ]).execute();

      const result = await postReimbursementTransaction(f.db, f.args);
      assertExists(result.journalId);
      const lines = await journalLines(f, result.journalId);
      const expenseLine = lines.find((line) =>
        line.accountId === f.account("expense")
      );
      const meals = lines.find((line) =>
        line.accountId === f.account("expense2")
      );
      assertExists(expenseLine);
      assertExists(meals);

      const dimensions = await f.db.selectFrom("journalLineDimension").select([
        "journalLineId",
        "dimensionId",
        "valueId",
      ]).where("companyId", "=", f.companyId).execute();

      // Exactly ONE row for the conflicted dimension, carrying the generic
      // value — not two, and not the legacy value.
      const onExpense = dimensions.filter((d) =>
        d.journalLineId === expenseLine.id
      );
      assertEquals(onExpense, [{
        journalLineId: expenseLine.id,
        dimensionId: f.costCenterDimensionId,
        valueId: f.otherCostCenterId,
      }]);
      assertEquals(
        dimensions.filter((d) => d.journalLineId === meals.id),
        [{
          journalLineId: meals.id,
          dimensionId: f.projectDimensionId,
          valueId: f.projectId,
        }],
      );
      assertEquals(dimensions.length, 2);
      // The payable control leg never carries line coding.
      const payable = lines.find((line) =>
        line.accountId === f.account("payable")
      );
      assertExists(payable);
      assertEquals(
        dimensions.some((d) => d.journalLineId === payable.id),
        false,
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting refuses a generic line dimension that is not active",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.insertInto("reimbursementLineDimension").values({
        id: `${f.secondLineId}-generic-pj`,
        reimbursementLineId: f.secondLineId,
        dimensionId: f.projectDimensionId,
        valueId: f.projectId,
        companyId: f.companyId,
      }).execute();
      await f.db.updateTable("dimension").set({ active: false })
        .where("id", "=", f.projectDimensionId).execute();

      await assertRejects(
        () => postReimbursementTransaction(f.db, f.args),
        Error,
        "not an active dimension in this company group",
      );
      assertEquals(
        (await f.db.selectFrom("reimbursement").select("status")
          .where("id", "=", f.reimbursementId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()).status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
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
      assertExists(posted.journalId);
      const originalLines = await journalLines(f, posted.journalId);

      const voidArgs = { ...f.args, type: "void" as const };
      const voided = await postReimbursementTransaction(f.db, voidArgs);
      // Void leaves the header pointing at the ORIGINAL journal.
      assertEquals(voided.journalId, posted.journalId);

      const journals = await f.db.selectFrom("journal").select([
        "id",
        "description",
      ]).where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Reimbursement")
        .execute();
      assertEquals(journals.length, 2);
      const reversal = journals.find((j) => j.id !== posted.journalId);
      assertExists(reversal);
      assertEquals(reversal.description.startsWith("VOID Reimbursement"), true);

      const reversalLines = await journalLines(f, reversal.id);
      assertEquals(reversalLines.length, originalLines.length);
      for (const original of originalLines) {
        assertEquals(
          lineByAccount(reversalLines, original.accountId),
          -Number(original.amount),
        );
      }
      await assertBalancedJournal(f, reversal.id);

      // The cost-center dimension is carried onto the reversing line.
      const dimensions = await f.db.selectFrom("journalLineDimension").select([
        "journalLineId",
        "dimensionId",
        "valueId",
      ]).where("companyId", "=", f.companyId).execute();
      assertEquals(dimensions.length, 2);
      assertEquals(
        dimensions.every((d) =>
          d.dimensionId === f.costCenterDimensionId &&
          d.valueId === f.costCenterId
        ),
        true,
      );
      const reversalLineIds = new Set(reversalLines.map((line) => line.id));
      assertEquals(
        dimensions.filter((d) => reversalLineIds.has(d.journalLineId)).length,
        1,
      );

      const header = await f.db.selectFrom("reimbursement").select([
        "status",
        "journalId",
        "voidedBy",
      ]).where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      assertEquals(header.status, "Voided");
      assertEquals(header.journalId, posted.journalId);
      assertEquals(header.voidedBy, "system");

      // Re-voiding returns the stored journal id without a second reversal.
      const again = await postReimbursementTransaction(f.db, voidArgs);
      assertEquals(again, voided);
      assertEquals(
        (await f.db.selectFrom("journal").select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Reimbursement").execute()).length,
        2,
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest("a Voided reimbursement cannot be posted", async () => {
  const f = await reimbursementFixture();
  try {
    await postReimbursementTransaction(f.db, f.args);
    await postReimbursementTransaction(f.db, { ...f.args, type: "void" });
    await assertRejects(
      () => postReimbursementTransaction(f.db, f.args),
      Error,
      "Cannot post reimbursement in status Voided",
    );
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
      await assertRejects(
        () =>
          postReimbursementTransaction(left.db, {
            ...left.args,
            companyId: `${left.companyId}-does-not-exist`,
          }),
        Error,
        "Reimbursement not found",
      );
      // Two companies holding the SAME id: posting the right one leaves the
      // left one untouched.
      await postReimbursementTransaction(right.db, right.args);
      assertEquals(
        (await left.db.selectFrom("reimbursement").select([
          "status",
          "journalId",
        ]).where("id", "=", reimbursementId)
          .where("companyId", "=", left.companyId)
          .executeTakeFirstOrThrow()),
        { status: "Draft", journalId: null },
      );
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// The subledger must equal the header.
// ---------------------------------------------------------------------------

databaseTest(
  "coding lines that do not sum to the header refuse to post",
  async () => {
    const f = await reimbursementFixture();
    try {
      await f.db.updateTable("reimbursementLine").set({ amount: 100 })
        .where("id", "=", f.secondLineId)
        .where("companyId", "=", f.companyId).execute();
      await assertRejects(
        () => postReimbursementTransaction(f.db, f.args),
        Error,
        "does not equal header amount",
      );
      assertEquals(
        (await f.db.selectFrom("reimbursement").select("status")
          .where("id", "=", f.reimbursementId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()).status,
        "Draft",
      );
      assertEquals(
        await f.db.selectFrom("journal").select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Reimbursement").execute(),
        [],
      );
    } finally {
      await f.cleanup();
    }
  },
);
