// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import issue from "./index";

databaseTest(
  "a consume-to-project job charges its material to the project account, not WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("a", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1
      });

      const backflush = await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1
      });
      expect(backflush.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Consumption")
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 30],
        [f.account("inventory"), -30]
      ]);
      expect(lines.some((line) => line.accountId === f.account("wip"))).toBe(
        false
      );

      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "dimensionId", "valueId"])
        .where("companyId", "=", f.companyId)
        .where("journalLineId", "in", [lines[0]!.id, lines[1]!.id])
        .execute();
      expect(
        tags
          .filter((tag) => tag.journalLineId === lines[0]!.id)
          .map((tag) => tag.valueId)
          .sort()
      ).toEqual([f.elementId, f.projectId].sort());
      expect(tags.some((tag) => tag.journalLineId === lines[1]!.id)).toBe(
        false
      );

      // Returning one unit through a manual adjustment credits the project.
      const returned = await issue(f.ctx, {
        type: "partToOperation",
        id: job.operationId,
        itemId,
        materialId: job.materialId,
        quantity: 1,
        adjustmentType: "Positive Adjmt."
      });
      expect(returned.error).toBeNull();

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select([
          "costType",
          "documentType",
          "documentId",
          "jobId",
          "quantity",
          "amount",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          row.jobId,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([
        ["Material", "Job Consumption", job.jobId, 3, 30],
        ["Material", "Job Consumption", job.jobId, -1, -10]
      ]);
      expect(ledger[0]!.journalLineId).toEqual(lines[0]!.id);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job with no charge number still posts its material to WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("nut", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("b", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1,
        consumeToProject: false
      });

      const backflush = await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1
      });
      expect(backflush.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("wip"), 30],
        [f.account("inventory"), -30]
      ]);
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
