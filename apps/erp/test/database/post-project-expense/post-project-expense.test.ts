// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { openChargeIds } from "@carbon/utils";
import { expect } from "vitest";
import {
  postProjectExpense,
  postTimesheet
} from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

databaseTest(
  "an expense on an Expense project posts Dr project expense / Cr GRNI and an Other Direct ledger row",
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
        [f.account("grni"), 40],
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
        .select(["costType", "amount", "coverage"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        costType: "Other Direct",
        coverage: null
      });
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
  "a 40.00 Billable service expense posts Dr COGS / Cr GRNI with a 40.00 billable item, and its reversal writes the item off",
  async () => {
    const f = await projectPostingFixture();
    try {
      const order = await f.addServiceOrder("expense");
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

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("journalId", "=", result.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("accountId")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("cogs"), 40],
        [f.account("grni"), 40]
      ]);
      const customerTag = await f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("journalLineId", "=", lines[0]!.id)
        .where("dimensionId", "=", f.dimension("Customer"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(customerTag?.valueId).toEqual(order.customerId);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["id", "quantity", "unitPrice", "amount", "coverage", "status"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        coverage: "Billable",
        status: "Unbilled"
      });
      expect(Number(items[0]!.quantity)).toEqual(1);
      expect(Number(items[0]!.unitPrice)).toEqual(40);
      expect(Number(items[0]!.amount)).toEqual(40);

      const entryRow = await f.db
        .selectFrom("projectExpenseEntry")
        .select(["coverage", "coverageReason"])
        .where("id", "=", entry.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(entryRow).toEqual({ coverage: "Billable", coverageReason: null });

      const reversal = await f.db
        .insertInto("projectExpenseEntry")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          employeeId: "system",
          entryDate: "2026-10-06",
          description: "Mileage",
          amount: -40,
          reversalOfId: entry.id,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const reversed = await invokePosting(
        handlesOf(f.ctx),
        "post-project-expense",
        {
          projectExpenseEntryId: reversal.id
        },
        postProjectExpense
      );
      expect(reversed.error).toBeNull();

      const reversalLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", reversed.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("accountId")
        .execute();
      expect(
        reversalLines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("cogs"), -40],
        [f.account("grni"), -40]
      ]);

      const after = await f.db
        .selectFrom("projectBillableItem")
        .select(["id", "status", "statusReason"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(after).toEqual([
        { id: items[0]!.id, status: "Written Off", statusReason: "Reversed" }
      ]);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["amount", "reversalOfId", "coverage"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount")
        .execute();
      expect(ledger.map((row) => [Number(row.amount), row.coverage])).toEqual([
        [-40, "Billable"],
        [40, "Billable"]
      ]);
      expect(ledger[0]!.reversalOfId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "reversing a service order's time and expense with a reason leaves no open charge, so the order can be cancelled",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.addServiceOrder("reverse", {
        laborWarrantyEndDate: "2026-01-01",
        laborPrice: 95
      });
      const time = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 2,
          status: "Draft",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-timesheet",
            { timesheetEntryIds: [time.id] },
            postTimesheet
          )
        ).error
      ).toBeNull();
      const expense = await f.db
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
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-project-expense",
            {
              projectExpenseEntryId: expense.id
            },
            postProjectExpense
          )
        ).error
      ).toBeNull();

      const before = await f.db
        .selectFrom("projectLedger")
        .select(["id", "reversalOfId"])
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(openChargeIds(before)).toHaveLength(2);

      // The rows the service order's Reverse writes: a timesheet correction
      // to 0 hours (createTimesheetCorrection) and an expense reversal
      // (buildExpenseReversal), each with its reason.
      const timeReversal = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: -2,
          status: "Submitted",
          reversalOfId: time.id,
          correctionReason: "Logged on the wrong order",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-timesheet",
            { timesheetEntryIds: [timeReversal.id] },
            postTimesheet
          )
        ).error
      ).toBeNull();
      const expenseReversal = await f.db
        .insertInto("projectExpenseEntry")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          employeeId: "system",
          entryDate: "2026-10-05",
          description: "Mileage",
          amount: -40,
          reversalOfId: expense.id,
          reversalReason: "Charged twice",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-project-expense",
            {
              projectExpenseEntryId: expenseReversal.id
            },
            postProjectExpense
          )
        ).error
      ).toBeNull();

      const after = await f.db
        .selectFrom("projectLedger")
        .select(["id", "reversalOfId", "amount", "coverage"])
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(after).toHaveLength(4);
      expect(openChargeIds(after)).toEqual([]);
      expect(after.every((row) => row.coverage === "Billable")).toBe(true);
      expect(after.reduce((sum, row) => sum + Number(row.amount), 0)).toEqual(
        0
      );

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["status", "statusReason"])
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([
        { status: "Written Off", statusReason: "Reversed" },
        { status: "Written Off", statusReason: "Reversed" }
      ]);

      const reason = await f.db
        .selectFrom("projectExpenseEntry")
        .select("reversalReason")
        .where("id", "=", expenseReversal.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(reason.reversalReason).toEqual("Charged twice");
    } finally {
      await f.cleanup();
    }
  }
);
