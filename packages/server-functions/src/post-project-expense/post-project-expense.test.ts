// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postProjectExpense from "./index";

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

      const result = await postProjectExpense(f.ctx, {
        projectExpenseEntryId: entry.id
      });
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
      const again = await postProjectExpense(f.ctx, {
        projectExpenseEntryId: entry.id
      });
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

      const result = await postProjectExpense(f.ctx, {
        projectExpenseEntryId: entry.id
      });
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
      const reversed = await postProjectExpense(f.ctx, {
        projectExpenseEntryId: reversal.id
      });
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
