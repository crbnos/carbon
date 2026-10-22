// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  createTimesheetCorrection,
  postTimesheet
} from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../fixtures/project-posting";

databaseTest(
  "a submitted entry on an Expense project posts a journal, a ledger row and the Posted stamp",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
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

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [entry.id]
        },
        postTimesheet
      );
      expect(result.data?.postedEntryIds).toEqual([entry.id]);
      expect(result.data?.journalIds).toHaveLength(1);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount", "documentType", "documentId"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 510],
        [f.account("labor-absorption"), -510]
      ]);
      expect(lines.every((line) => line.documentId === entry.id)).toBe(true);

      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["dimensionId", "valueId"])
        .where("journalLineId", "=", lines[0]!.id)
        .where("companyId", "=", f.companyId)
        .orderBy("dimensionId")
        .execute();
      expect(tags).toEqual(
        [
          { dimensionId: f.dimension("Employee"), valueId: "system" },
          { dimensionId: f.dimension("Project"), valueId: f.projectId },
          {
            dimensionId: f.dimension("ProjectElement"),
            valueId: f.elementId
          }
        ].sort((a, b) => a.dimensionId.localeCompare(b.dimensionId))
      );

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select([
          "costType",
          "documentType",
          "documentId",
          "amount",
          "quantity",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        costType: "Labor",
        documentType: "Timesheet",
        documentId: entry.id,
        journalLineId: lines[0]!.id
      });
      expect(Number(ledger[0]!.amount)).toEqual(510);
      expect(Number(ledger[0]!.quantity)).toEqual(6);

      const posted = await f.db
        .selectFrom("timesheetEntry")
        .select(["status", "costRate", "journalId", "postedAt"])
        .where("id", "=", entry.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(posted.status).toEqual("Posted");
      expect(Number(posted.costRate)).toEqual(85);
      expect(posted.journalId).toEqual(result.data?.journalIds[0]);
      expect(posted.postedAt).not.toBeNull();

      const element = await f.db
        .selectFrom("projectElement")
        .select("stateId")
        .where("id", "=", f.elementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(element.stateId).toEqual(f.state("doing"));

      // Posting again is a no-op: the entry is no longer Submitted.
      const again = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [entry.id]
        },
        postTimesheet
      );
      expect(again.data?.postedEntryIds).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an entry on a Capitalize element debits the CIP account and builds the asset",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { fixedAssetId } = await f.addCapitalAsset({
        status: "Under Construction",
        finalAssetElement: true
      });
      const entry = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 10,
          status: "Submitted",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [entry.id]
        },
        postTimesheet
      );
      expect(result.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("cip"), 850],
        [f.account("labor-absorption"), -850]
      ]);

      const cipRows = await f.db
        .selectFrom("fixedAssetCipCost")
        .select([
          "fixedAssetId",
          "sourceType",
          "sourceDocumentId",
          "projectId",
          "projectElementId",
          "amount",
          "journalId",
          "postCapitalization"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(cipRows).toHaveLength(1);
      expect(cipRows[0]).toMatchObject({
        fixedAssetId,
        sourceType: "Timesheet",
        sourceDocumentId: entry.id,
        projectId: f.projectId,
        projectElementId: f.elementId,
        journalId: result.data?.journalIds[0],
        postCapitalization: false
      });
      expect(Number(cipRows[0]!.amount)).toEqual(850);

      const asset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "status"])
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toEqual(850);
      expect(asset.status).toEqual("Under Construction");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Draft entry on a Standard project is not posted", async () => {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  try {
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

    const result = await invokePosting(
      handlesOf(f.ctx),
      "post-timesheet",
      {
        timesheetEntryIds: [entry.id]
      },
      postTimesheet
    );
    expect(result.data?.postedEntryIds).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a Draft entry on a Service node inside the labor warranty posts to Warranty Expense with a 0.00 billable item",
  async () => {
    const f = await projectPostingFixture();
    try {
      const order = await f.addServiceOrder("warranty", {
        laborWarrantyEndDate: "2027-11-01",
        laborPrice: 95
      });
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

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [entry.id]
        },
        postTimesheet
      );
      expect(result.error).toBeNull();
      expect(result.data?.postedEntryIds).toEqual([entry.id]);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("warranty"), 170],
        [f.account("labor-absorption"), -170]
      ]);
      const customerTag = await f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("journalLineId", "=", lines[0]!.id)
        .where("dimensionId", "=", f.dimension("Customer"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(customerTag?.valueId).toEqual(order.customerId);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["id", "coverage", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.coverage).toEqual("Warranty");
      expect(Number(ledger[0]!.amount)).toEqual(170);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select([
          "projectLedgerId",
          "itemId",
          "quantity",
          "unitPrice",
          "amount",
          "coverage",
          "status",
          "description"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        projectLedgerId: ledger[0]!.id,
        itemId: order.laborItemId,
        coverage: "Warranty",
        status: "Unbilled",
        description: "Labor (Covered by warranty)"
      });
      expect(Number(items[0]!.quantity)).toEqual(2);
      expect(Number(items[0]!.unitPrice)).toEqual(0);
      expect(Number(items[0]!.amount)).toEqual(0);

      const posted = await f.db
        .selectFrom("timesheetEntry")
        .select(["status", "coverage", "coverageReason"])
        .where("id", "=", entry.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(posted).toEqual({
        status: "Posted",
        coverage: "Warranty",
        coverageReason: null
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a correction of a Billable service entry reverses at the original's coverage and writes off its billable item",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.addServiceOrder("billable", {
        laborWarrantyEndDate: "2026-01-01",
        laborPrice: 95
      });
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

      const original = await f.db
        .selectFrom("projectBillableItem")
        .select(["id", "unitPrice", "amount", "coverage"])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(original.coverage).toEqual("Billable");
      expect(Number(original.unitPrice)).toEqual(95);
      expect(Number(original.amount)).toEqual(190);

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
      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [reversal.id]
        },
        postTimesheet
      );
      expect(result.error).toBeNull();

      const reversalLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("documentId", "=", reversal.id)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        reversalLines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("labor-absorption"), 170],
        [f.account("cogs"), -170]
      ]);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["id", "status", "statusReason"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([
        { id: original.id, status: "Written Off", statusReason: "Reversed" }
      ]);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["coverage", "amount", "reversalOfId"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount")
        .execute();
      expect(ledger.map((row) => [row.coverage, Number(row.amount)])).toEqual([
        ["Billable", -170],
        ["Billable", 170]
      ]);
      expect(ledger[0]!.reversalOfId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

/**
 * An Exempt employee job for the fixture's user, the timekeeping mode, and
 * 5 Submitted entries of 10 h (50 h) in the week of 2026-10-05.
 */
async function exemptWeek(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  mode: "Standard" | "DCAA"
) {
  const locationId = `${f.prefix}-location`;
  await f.db
    .updateTable("companySettings")
    .set({ timekeepingControls: mode, standardWeeklyHours: 40 })
    .where("id", "=", f.companyId)
    .execute();
  await f.db
    .insertInto("location")
    .values({
      id: locationId,
      name: "Plant",
      addressLine1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId: f.companyId,
      createdBy: PROJECT_TEST_USER
    })
    .execute();
  await f.db
    .insertInto("employeeJob")
    .values({
      id: PROJECT_TEST_USER,
      companyId: f.companyId,
      locationId,
      flsaStatus: "Exempt"
    })
    .execute();
  const rows = await f.db
    .insertInto("timesheetEntry")
    .values(
      [
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "2026-10-09"
      ].map((entryDate) => ({
        employeeId: PROJECT_TEST_USER,
        entryDate,
        projectId: f.projectId,
        projectElementId: f.elementId,
        laborCategoryId: f.laborCategoryId,
        hours: 10,
        status: "Submitted" as const,
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      }))
    )
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}

async function ledgerTotal(
  f: Awaited<ReturnType<typeof projectPostingFixture>>
) {
  const rows = await f.db
    .selectFrom("projectLedger")
    .select("amount")
    .where("companyId", "=", f.companyId)
    .execute();
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
}

databaseTest(
  "Standard mode: an Exempt employee's 50 h week posts at the full rate",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const ids = await exemptWeek(f, "Standard");
      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        { timesheetEntryIds: ids },
        postTimesheet
      );
      expect(result.error).toBeNull();
      expect(await ledgerTotal(f)).toEqual(50 * 85);
      const entries = await f.db
        .selectFrom("timesheetEntry")
        .select(["costRate", "dilutionFactor"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(entries.every((entry) => Number(entry.costRate) === 85)).toBe(
        true
      );
      expect(entries.every((entry) => entry.dilutionFactor === null)).toBe(
        true
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: an Exempt employee's 50 h week posts diluted, and a correction re-dilutes the week",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const ids = await exemptWeek(f, "DCAA");
      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        { timesheetEntryIds: ids },
        postTimesheet
      );
      expect(posted.error).toBeNull();
      // 40 h × 85.00, spread over 50 h at 68.00.
      expect(await ledgerTotal(f)).toEqual(3400);
      const stamped = await f.db
        .selectFrom("timesheetEntry")
        .select(["costRate", "dilutionFactor"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(stamped.every((entry) => Number(entry.costRate) === 68)).toBe(
        true
      );
      expect(
        stamped.every((entry) => Number(entry.dilutionFactor) === 0.8)
      ).toBe(true);

      // A correction removes the first day's 10 h: the week has 40 h.
      const reversal = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: PROJECT_TEST_USER,
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: -10,
          reversalOfId: ids[0],
          correctionReason: "Charged to the wrong week",
          status: "Submitted",
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const corrected = await invokePosting(
        handlesOf(f.ctx),
        "post-timesheet",
        {
          timesheetEntryIds: [reversal.id]
        },
        postTimesheet
      );
      expect(corrected.error).toBeNull();

      // The reversal takes back 680.00, and the 4 other days re-dilute to
      // factor 1 (+170.00 each): the week costs 40 h × 85.00.
      expect(await ledgerTotal(f)).toEqual(3400);
      const adjustments = await f.db
        .selectFrom("projectLedger")
        .select(["amount", "quantity", "documentId"])
        .where("companyId", "=", f.companyId)
        .where("quantity", "=", 0)
        .execute();
      expect(adjustments).toHaveLength(4);
      expect(adjustments.every((row) => Number(row.amount) === 170)).toBe(true);
      const redilutedRates = await f.db
        .selectFrom("timesheetEntry")
        .select(["costRate", "dilutionFactor"])
        .where("companyId", "=", f.companyId)
        .where("id", "in", ids.slice(1))
        .execute();
      expect(
        redilutedRates.every(
          (entry) =>
            Number(entry.costRate) === 85 && Number(entry.dilutionFactor) === 1
        )
      ).toBe(true);
      // The adjustments post a balanced journal against labor absorption.
      const lines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(lines.reduce((sum, line) => sum + Number(line.amount), 0)).toEqual(
        0
      );
    } finally {
      await f.cleanup();
    }
  }
);

async function post(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  timesheetEntryIds: string[]
) {
  const result = await invokePosting(
    handlesOf(f.ctx),
    "post-timesheet",
    { timesheetEntryIds },
    postTimesheet
  );
  expect(result.error).toBeNull();
  return result;
}

async function submittedEntry(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  hours: number
) {
  const entry = await f.db
    .insertInto("timesheetEntry")
    .values({
      employeeId: "system",
      entryDate: "2026-10-05",
      projectId: f.projectId,
      projectElementId: f.elementId,
      laborCategoryId: f.laborCategoryId,
      hours,
      status: "Submitted",
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return entry.id;
}

databaseTest(
  "a reversal credits the account its original debited and keeps its unallowable flag after the project's treatment changes",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      // 8 h × 85.00 = Dr Project WIP 680.00 on a Contract project.
      const entryId = await submittedEntry(f, 8);
      await post(f, [entryId]);

      // The project moves to Expense and the element becomes unallowable.
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

      const { reversalId } = await createTimesheetCorrection(f.db, {
        companyId: f.companyId,
        userId: "system",
        timesheetEntryId: entryId,
        hours: 0,
        correctionReason: "Charged in error"
      });
      await post(f, [reversalId]);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("documentId", "=", reversalId)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("labor-absorption"), 680],
        [f.account("project-wip"), -680]
      ]);

      const reversalRow = await f.db
        .selectFrom("projectLedger")
        .select(["amount", "unallowable", "reversalOfId"])
        .where("documentId", "=", reversalId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(reversalRow.amount)).toEqual(-680);
      expect(reversalRow.unallowable).toBe(false);
      expect(reversalRow.reversalOfId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a labor transfer rebooks at the rate the original booked, not the rate edited since",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const entryId = await submittedEntry(f, 8);
      await post(f, [entryId]);

      // The rate for the entry's date is edited after it posted at 85.00.
      await f.db
        .updateTable("laborCategoryRate")
        .set({ costRate: 90 })
        .where("laborCategoryId", "=", f.laborCategoryId)
        .where("companyId", "=", f.companyId)
        .execute();
      const otherElementId = `${f.prefix}-element-2`;
      await f.db
        .insertInto("projectElement")
        .values({
          id: otherElementId,
          projectId: f.projectId,
          readableId: "TP-2",
          sequence: 2,
          type: "Task",
          name: "Build",
          stateId: f.state("todo"),
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const { reversalId, replacementId, isTransfer } =
        await createTimesheetCorrection(f.db, {
          companyId: f.companyId,
          userId: "system",
          timesheetEntryId: entryId,
          hours: 8,
          correctionReason: "Wrong charge number",
          projectId: f.projectId,
          projectElementId: otherElementId
        });
      expect(isTransfer).toBe(true);
      await post(f, [reversalId, replacementId!]);

      const rows = await f.db
        .selectFrom("projectLedger")
        .select(["documentId", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      const amountOf = (id: string) =>
        Number(rows.find((row) => row.documentId === id)?.amount);
      expect(amountOf(reversalId)).toEqual(-680);
      expect(amountOf(replacementId!)).toEqual(680);

      // Labor absorption holds exactly the 680.00 the time booked.
      const absorption = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("accountId", "=", f.account("labor-absorption"))
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        absorption.reduce((sum, line) => sum + Number(line.amount), 0)
      ).toEqual(-680);

      const replacement = await f.db
        .selectFrom("timesheetEntry")
        .select("costRate")
        .where("id", "=", replacementId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(replacement.costRate)).toEqual(85);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: a correction after a re-dilution reverses the entry's own row and writes off its Time & Materials item",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const customerId = `${f.prefix}-customer`;
      const itemId = `${f.prefix}-item`;
      const contractId = `${f.prefix}-contract`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .updateTable("laborCategoryRate")
          .set({ billRate: 150 })
          .where("laborCategoryId", "=", f.laborCategoryId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("customer")
          .values({ id: customerId, name: f.prefix, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: `${f.prefix}-ENG`,
            name: "Engineering services",
            type: "Service",
            itemTrackingType: "Non-Inventory",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("customerContract")
          .values({
            id: contractId,
            customerContractId: `CON-${f.prefix}`,
            name: "T&M",
            customerId,
            status: "Active",
            closeDate: "2026-01-01",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            billingFrequency: "Month",
            billingAlignment: "Calendar",
            billingTiming: "Arrears",
            currencyCode: "USD",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("customerContractLine")
          .values({
            id: `${contractId}-line`,
            customerContractId: contractId,
            revenueType: "One-time",
            itemId,
            description: "Engineering T&M",
            quantity: 1,
            rate: 0,
            startDate: "2026-01-01",
            billingMethod: "Time & Materials",
            revenueMethod: "Right to Invoice",
            materialHandlingPercent: 0.1,
            projectId: f.projectId,
            projectElementId: f.elementId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const ids = await exemptWeek(f, "DCAA");
      await post(f, ids);
      const itemOf = async (entryId: string) =>
        f.db
          .selectFrom("projectBillableItem")
          .innerJoin(
            "projectLedger",
            "projectLedger.id",
            "projectBillableItem.projectLedgerId"
          )
          .select([
            "projectBillableItem.status",
            "projectBillableItem.statusReason"
          ])
          .where("projectLedger.documentId", "=", entryId)
          .where("projectBillableItem.companyId", "=", f.companyId)
          .execute();
      expect(await itemOf(ids[1]!)).toEqual([
        { status: "Unbilled", statusReason: null }
      ]);

      // Removing the first day re-dilutes the other four: each gets a
      // quantity 0 adjustment row.
      const first = await createTimesheetCorrection(f.db, {
        companyId: f.companyId,
        userId: PROJECT_TEST_USER,
        timesheetEntryId: ids[0]!,
        hours: 0,
        correctionReason: "Charged to the wrong week"
      });
      await post(f, [first.reversalId]);

      const second = await createTimesheetCorrection(f.db, {
        companyId: f.companyId,
        userId: PROJECT_TEST_USER,
        timesheetEntryId: ids[1]!,
        hours: 0,
        correctionReason: "Charged to the wrong week"
      });
      await post(f, [second.reversalId]);

      const originalRow = await f.db
        .selectFrom("projectLedger")
        .select("id")
        .where("documentId", "=", ids[1]!)
        .where("quantity", "<>", 0)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const reversalRow = await f.db
        .selectFrom("projectLedger")
        .select("reversalOfId")
        .where("documentId", "=", second.reversalId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(reversalRow.reversalOfId).toEqual(originalRow.id);
      expect(await itemOf(ids[1]!)).toEqual([
        { status: "Written Off", statusReason: "Reversed" }
      ]);

      // The entry's rows (its post, its adjustment, its reversal) net to 0.
      const net = await f.db
        .selectFrom("projectLedger")
        .select("amount")
        .where("documentId", "in", [ids[1]!, second.reversalId])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(net.reduce((sum, row) => sum + Number(row.amount), 0)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
