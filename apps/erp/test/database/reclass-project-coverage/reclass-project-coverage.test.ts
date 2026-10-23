// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  postTimesheet,
  reclassProjectCoverage
} from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

databaseTest(
  "reclassing a 120.00 Warranty labor charge to Billable moves it to COGS and replaces its billable item",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.addServiceOrder("reclass", {
        laborWarrantyEndDate: "2027-11-01",
        laborPrice: 95
      });
      await f.db
        .updateTable("laborCategoryRate")
        .set({ costRate: 60 })
        .where("laborCategoryId", "=", f.laborCategoryId)
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
            { timesheetEntryIds: [entry.id] },
            postTimesheet
          )
        ).error
      ).toBeNull();

      const charge = await f.db
        .selectFrom("projectLedger")
        .select(["id", "amount", "coverage"])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(charge.coverage).toEqual("Warranty");
      expect(Number(charge.amount)).toEqual(120);

      const result = await invokePosting(
        handlesOf(f.ctx),
        "reclass-project-coverage",
        {
          projectLedgerId: charge.id,
          coverage: "Billable",
          reason: "Damage by the customer"
        },
        reclassProjectCoverage
      );
      expect(result.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "documentType", "documentId"])
        .where("journalId", "=", result.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("cogs"), 120],
        [f.account("warranty"), -120]
      ]);
      expect(
        lines.every(
          (line) =>
            line.documentType === "Timesheet" && line.documentId === entry.id
        )
      ).toBe(true);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["id", "amount", "coverage", "coverageReason", "reversalOfId"])
        .where("companyId", "=", f.companyId)
        .orderBy("createdAt")
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          Number(row.amount),
          row.coverage,
          row.coverageReason,
          row.reversalOfId
        ])
      ).toEqual([
        [120, "Warranty", null, null],
        [120, "Billable", "Damage by the customer", null],
        [-120, "Warranty", null, charge.id]
      ]);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select([
          "projectLedgerId",
          "status",
          "unitPrice",
          "amount",
          "description"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("createdAt")
        .execute();
      expect(
        items.map((item) => [
          item.projectLedgerId,
          item.status,
          Number(item.unitPrice),
          Number(item.amount),
          item.description
        ])
      ).toEqual([
        [charge.id, "Written Off", 0, 0, "Labor (Covered by warranty)"],
        [result.data!.projectLedgerId, "Unbilled", 95, 190, "Labor"]
      ]);

      const updated = await f.db
        .selectFrom("timesheetEntry")
        .select(["coverage", "coverageReason"])
        .where("id", "=", entry.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(updated).toEqual({
        coverage: "Billable",
        coverageReason: "Damage by the customer"
      });

      // No change, or a second reclass of the reversed row, is refused.
      const same = await invokePosting(
        handlesOf(f.ctx),
        "reclass-project-coverage",
        {
          projectLedgerId: result.data!.projectLedgerId,
          coverage: "Billable",
          reason: "Again"
        },
        reclassProjectCoverage
      );
      expect(same.error?.status).toEqual(422);
      const stale = await invokePosting(
        handlesOf(f.ctx),
        "reclass-project-coverage",
        {
          projectLedgerId: charge.id,
          coverage: "Contract",
          reason: "Again"
        },
        reclassProjectCoverage
      );
      expect(stale.error?.status).toEqual(422);

      // A correction now reverses the reclassed row at Billable.
      const reversal = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: -2,
          status: "Submitted",
          reversalOfId: entry.id,
          correctionReason: "Wrong node",
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
            { timesheetEntryIds: [reversal.id] },
            postTimesheet
          )
        ).error
      ).toBeNull();
      const reversalRow = await f.db
        .selectFrom("projectLedger")
        .select(["reversalOfId", "coverage"])
        .where("documentId", "=", reversal.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(reversalRow).toEqual({
        reversalOfId: result.data!.projectLedgerId,
        coverage: "Billable"
      });
      const newItem = await f.db
        .selectFrom("projectBillableItem")
        .select("status")
        .where("projectLedgerId", "=", result.data!.projectLedgerId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(newItem.status).toEqual("Written Off");
    } finally {
      await f.cleanup();
    }
  }
);
