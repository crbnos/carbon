// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postTimesheet from "./index";

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

      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
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
      const again = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
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

      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
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

    const result = await postTimesheet(f.ctx, {
      timesheetEntryIds: [entry.id]
    });
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

      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [entry.id]
      });
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
        (await postTimesheet(f.ctx, { timesheetEntryIds: [entry.id] })).error
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
      const result = await postTimesheet(f.ctx, {
        timesheetEntryIds: [reversal.id]
      });
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
