// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
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

async function completeJob(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  jobId: string,
  quantity: number,
  locationId: string
) {
  await sql`
    SELECT complete_job_to_inventory(
      ${jobId}, ${quantity}, NULL, ${locationId}, ${f.companyId}, 'system'
    )
  `.execute(f.db);
}

databaseTest(
  "completing a consume-to-project job charges the project and receives nothing",
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

      // A labor event that was never posted on its own: completion posts it.
      await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-05T08:00:00Z",
          endTime: "2026-10-05T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      await completeJob(f, job.jobId, 1, locationId);

      const receipts = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Receipt")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(receipts).toEqual([]);

      const outputLayers = await f.db
        .selectFrom("costLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Receipt")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(outputLayers).toEqual([]);

      const wipLines = await f.db
        .selectFrom("journalLine")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("wip"))
        .where("documentId", "=", job.jobId)
        .execute();
      expect(wipLines).toEqual([]);

      const laborLines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Production Event")
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        laborLines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 100],
        [f.account("labor-absorption"), -100]
      ]);
      const laborTags = await f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("companyId", "=", f.companyId)
        .where("journalLineId", "=", laborLines[0]!.id)
        .where("dimensionId", "in", [
          f.dimension("Project"),
          f.dimension("ProjectElement")
        ])
        .execute();
      expect(laborTags.map((tag) => tag.valueId).sort()).toEqual(
        [f.elementId, f.projectId].sort()
      );

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "documentType", "amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .orderBy("costType")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          Number(row.amount)
        ])
      ).toEqual([
        ["Material", "Job Consumption", 30],
        ["Labor", "Production Event", 100]
      ]);
      expect(ledger[1]!.journalLineId).toEqual(laborLines[0]!.id);

      const completed = await f.db
        .selectFrom("job")
        .select(["status", "quantityComplete", "quantityReceivedToInventory"])
        .where("id", "=", job.jobId)
        .executeTakeFirstOrThrow();
      expect(completed.status).toEqual("Completed");
      expect(Number(completed.quantityComplete)).toEqual(1);
      expect(Number(completed.quantityReceivedToInventory ?? 0)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "completing a consume-to-project job backflushes its material to the project",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("washer", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("c", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1
      });

      await completeJob(f, job.jobId, 1, locationId);

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

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "itemId", "quantity", "amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.itemId,
          Number(row.quantity),
          Number(row.amount),
          row.journalLineId
        ])
      ).toEqual([["Material", itemId, 3, 30, lines[0]!.id]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "completing a job with no charge number still receives it and discharges WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("pin", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("d", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1,
        consumeToProject: false
      });

      await completeJob(f, job.jobId, 1, locationId);

      const receipts = await f.db
        .selectFrom("itemLedger")
        .select("quantity")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Receipt")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(receipts.map((row) => Number(row.quantity))).toEqual([1]);

      const wipLines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("wip"))
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(wipLines.map((line) => Number(line.amount))).toEqual([30, -30]);

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

databaseTest(
  "scrapping on a consume-to-project job relieves the project account, not WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("rivet", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("e", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 2
      });
      const scrapReasonId = `${f.prefix}-scrap-reason`;
      await f.db
        .insertInto("scrapReason")
        .values({
          id: scrapReasonId,
          name: "Damaged",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const scrapped = await issue(f.ctx, {
        type: "jobOperationScrap",
        jobOperationId: job.operationId,
        quantity: 1,
        scrapReasonId
      });
      expect(scrapped.error).toBeNull();

      const scrapLines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Scrap")
        .where("documentId", "=", job.jobId)
        .orderBy("accountId")
        .execute();
      expect(
        Object.fromEntries(
          scrapLines.map((line) => [line.accountId, Number(line.amount)])
        )
      ).toEqual({
        [f.account("adjustment-variance")]: 30,
        [f.account("project-expense")]: -30
      });

      const wipLines = await f.db
        .selectFrom("journalLine")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("wip"))
        .execute();
      expect(wipLines).toEqual([]);

      // The project account nets to zero: the scrapped units' material went
      // in with the backflush and out with the scrap.
      const projectAccountNet = await f.db
        .selectFrom("journalLine")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("project-expense"))
        .executeTakeFirst();
      expect(Number(projectAccountNet?.amount ?? 0)).toEqual(0);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["documentType", "quantity", "amount", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      const projectCredit = scrapLines.find(
        (line) => line.accountId === f.account("project-expense")
      );
      expect(
        ledger.map((row) => [
          row.documentType,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([
        ["Job Consumption", 3, 30],
        ["Scrap", -1, -30]
      ]);
      expect(ledger[1]!.journalLineId).toEqual(projectCredit!.id);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "completing a consume-to-project job names a missing account default, not Statistical",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("nut", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("d", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 1,
        jobQuantity: 1
      });
      await f.db
        .updateTable("accountDefault")
        .set({ projectExpenseAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();

      const completion = completeJob(f, job.jobId, 1, locationId);
      await expect(completion).rejects.toThrow(
        "Set Project Expense in Account Defaults before you charge an Expense project"
      );
      await expect(completion).rejects.not.toThrow(/Statistical/);

      const unchanged = await f.db
        .selectFrom("job")
        .select("status")
        .where("id", "=", job.jobId)
        .executeTakeFirstOrThrow();
      expect(unchanged.status).not.toEqual("Completed");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "project_posting_account returns NULL for a Statistical project only",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Statistical" });
    try {
      const account = (projectId: string) =>
        sql<{ account: string | null }>`
          SELECT project_posting_account(
            ${f.companyId}, ${projectId}, ${f.elementId}, '2026-10-05'::date
          ) AS account
        `.execute(f.db);

      const statistical = await account(f.projectId);
      expect(statistical.rows[0]!.account).toBeNull();

      await f.db
        .updateTable("project")
        .set({ costTreatment: "Contract" })
        .where("id", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      const contract = await account(f.projectId);
      expect(contract.rows[0]!.account).toEqual(f.account("project-wip"));

      await f.db
        .updateTable("accountDefault")
        .set({ projectWorkInProgressAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(account(f.projectId)).rejects.toThrow(
        "Set Project Work in Progress in Account Defaults before you charge a Contract project"
      );

      await expect(account(`${f.projectId}-missing`)).rejects.toThrow(
        /does not exist/
      );
    } finally {
      await f.cleanup();
    }
  }
);
