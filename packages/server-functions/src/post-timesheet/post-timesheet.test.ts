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
