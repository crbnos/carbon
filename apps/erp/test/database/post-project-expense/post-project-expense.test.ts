// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postProjectExpense } from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

databaseTest(
  "an expense on an Expense project posts Dr project expense / Cr the payable and an Other Direct ledger row",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
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

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-project-expense",
        {
          projectExpenseEntryId: entry.id
        },
        postProjectExpense
      );
      expect(result.error).toBeNull();
      expect(result.data?.posted).toBe(true);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "documentType", "documentId"])
        .where("companyId", "=", f.companyId)
        .orderBy("accountId")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("payables"), 40],
        [f.account("project-expense"), 40]
      ]);
      expect(
        lines.every(
          (line) =>
            line.documentType === "Project Expense" &&
            line.documentId === entry.id
        )
      ).toBe(true);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ costType: "Other Direct" });
      expect(Number(ledger[0]!.amount)).toEqual(40);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([]);

      const posted = await f.db
        .selectFrom("projectExpenseEntry")
        .select("journalId")
        .where("id", "=", entry.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(posted.journalId).toEqual(result.data?.journalId);

      // Posting again is a no-op.
      const again = await invokePosting(
        handlesOf(f.ctx),
        "post-project-expense",
        {
          projectExpenseEntryId: entry.id
        },
        postProjectExpense
      );
      expect(again.data?.posted).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an expense reversal credits the account its original debited and keeps its unallowable flag after the project's treatment changes",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const post = async (projectExpenseEntryId: string) => {
        const result = await invokePosting(
          handlesOf(f.ctx),
          "post-project-expense",
          { projectExpenseEntryId },
          postProjectExpense
        );
        expect(result.error).toBeNull();
      };
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
      // Dr Project WIP 40.00 on a Contract project.
      await post(entry.id);

      await f.db
        .updateTable("project")
        .set({ costTreatment: "Expense" })
        .where("id", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("projectElement")
        .set({ isUnallowable: true })
        .where("id", "=", f.elementId)
        .where("companyId", "=", f.companyId)
        .execute();

      const reversal = await f.db
        .insertInto("projectExpenseEntry")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          employeeId: "system",
          entryDate: "2026-10-05",
          description: "Mileage",
          amount: -40,
          reversalOfId: entry.id,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await post(reversal.id);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("documentId", "=", reversal.id)
        .where("companyId", "=", f.companyId)
        .orderBy("accountId")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual(
        [
          [f.account("payables"), -40],
          [f.account("project-wip"), -40]
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );

      const row = await f.db
        .selectFrom("projectLedger")
        .select(["amount", "unallowable", "reversalOfId"])
        .where("documentId", "=", reversal.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(row.amount)).toEqual(-40);
      expect(row.unallowable).toBe(false);
      expect(row.reversalOfId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an expense credits the employee payable when it is set, and its reversal credits what the original did",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const entry = async (values: { amount: number; reversalOfId?: string }) => {
        const row = await f.db
          .insertInto("projectExpenseEntry")
          .values({
            projectId: f.projectId,
            projectElementId: f.elementId,
            employeeId: "system",
            entryDate: "2026-10-05",
            description: "Mileage",
            companyId: f.companyId,
            createdBy: "system",
            ...values
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const posted = await invokePosting(
          handlesOf(f.ctx),
          "post-project-expense",
          { projectExpenseEntryId: row.id },
          postProjectExpense
        );
        expect(posted.error).toBeNull();
        return row.id;
      };
      const original = await entry({ amount: 40 });

      await f.db
        .insertInto("account")
        .values({
          id: f.account("employee-payable"),
          name: "Employee reimbursements payable",
          class: "Liability",
          incomeBalance: "Balance Sheet",
          companyGroupId: f.groupId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .updateTable("accountDefault")
        .set({
          employeeReimbursementsPayableAccount: f.account("employee-payable")
        })
        .where("companyId", "=", f.companyId)
        .execute();

      const reversal = await entry({ amount: -40, reversalOfId: original });
      const next = await entry({ amount: 25 });

      const credits = async (documentId: string) => {
        const lines = await f.db
          .selectFrom("journalLine")
          .select(["accountId", "amount"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", documentId)
          .where("accountId", "!=", f.account("project-expense"))
          .execute();
        return lines.map((line) => [line.accountId, Number(line.amount)]);
      };
      expect(await credits(reversal)).toEqual([[f.account("payables"), -40]]);
      expect(await credits(next)).toEqual([
        [f.account("employee-payable"), 25]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
