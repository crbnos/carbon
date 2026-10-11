// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The project posting paths follow the always-post rule
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1): a
// company before its accounting cutover writes the journal as Provisional,
// with no accounting period, and the projectLedger row as usual.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postProjectExpense from "../post-project-expense";
import postProjectIssue from "../post-project-issue";
import postTimesheet from "../post-timesheet";
import { projectPostingFixture } from "./project-posting-test-fixture";

async function beforeCutover(
  f: Awaited<ReturnType<typeof projectPostingFixture>>
) {
  await f.db
    .updateTable("companySettings")
    .set({ accountingCutoverDate: null })
    .where("id", "=", f.companyId)
    .execute();
}

async function journals(f: Awaited<ReturnType<typeof projectPostingFixture>>) {
  return f.db
    .selectFrom("journal")
    .select(["id", "status", "accountingPeriodId", "sourceType"])
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "before the cutover, an expense posts a Provisional journal with no period and its ledger row",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await beforeCutover(f);
      const entry = await f.db
        .insertInto("projectExpenseEntry")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          employeeId: "system",
          entryDate: "2026-10-05",
          description: "Mileage",
          amount: 40,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await postProjectExpense(f.ctx, {
        projectExpenseEntryId: entry.id
      });
      expect(result.error).toBeNull();

      expect(await journals(f)).toEqual([
        {
          id: result.data?.journalId,
          status: "Provisional",
          accountingPeriodId: null,
          sourceType: "Project Expense"
        }
      ]);
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0]!.amount)).toEqual(40);
      expect(ledger[0]!.journalLineId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "before the cutover, a timesheet with no labor absorption default posts a stand-in line on retained earnings",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await beforeCutover(f);
      await f.db
        .updateTable("accountDefault")
        .set({ laborAbsorptionAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const defaults = await f.db
        .selectFrom("accountDefault")
        .select("retainedEarningsAccount")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const entry = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 6,
          status: "Submitted",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
      expect(result.error).toBeNull();
      expect(result.data?.postedEntryIds).toEqual([entry.id]);

      const [journal] = await journals(f);
      expect(journal).toMatchObject({
        status: "Provisional",
        accountingPeriodId: null,
        sourceType: "Timesheet"
      });
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "accountDefaultRole"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [
          line.accountId,
          Number(line.amount),
          line.accountDefaultRole
        ])
      ).toEqual([
        [f.account("project-expense"), 510, null],
        [defaults.retainedEarningsAccount, -510, "laborAbsorptionAccount"]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "after the cutover, a timesheet with no labor absorption default is refused",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ laborAbsorptionAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const entry = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 6,
          status: "Submitted",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
      expect(result.error?.status).toEqual(400);
      expect(await journals(f)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "before the cutover, a project issue posts a Provisional journal with no period",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await beforeCutover(f);
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });

      const issued = await postProjectIssue(f.ctx, {
        projectId: f.projectId,
        projectElementId: f.elementId,
        itemId,
        locationId,
        quantity: 5,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(50);

      expect(await journals(f)).toEqual([
        {
          id: expect.any(String),
          status: "Provisional",
          accountingPeriodId: null,
          sourceType: "Project Issue"
        }
      ]);
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger.map((row) => Number(row.amount))).toEqual([50]);
    } finally {
      await f.cleanup();
    }
  }
);
