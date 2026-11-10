// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Closing a project (audit `.ai/runs/2026-10-22-project-accounting-audit.md`
// D11): a Contract project's Project WIP that no progress contract line
// owns moves to cost of goods sold in one journal, each ledger row once; a
// row a Right to Invoice line owns stays for the revenue run. Close refuses
// a project that still holds stock, has a borrow not paid back, or has an
// asset under construction.

import { expect } from "vitest";
import { proposeRevenueRecognitionRun } from "../../../app/modules/accounting/accounting.service";
import { closeProject } from "../../../app/modules/projects/projects.service";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";
import { dropRecognitionRuns } from "../fixtures/run";

type Fixture = Awaited<ReturnType<typeof projectBillingTestFixture>>;
type Project = { projectId: string; rootId: string; childId: string };

async function setStatus(
  f: Fixture,
  projectId: string,
  status: "Released" | "Technically Complete"
) {
  await f.db
    .updateTable("project")
    .set({ status })
    .where("id", "=", projectId)
    .where("companyId", "=", f.companyId)
    .execute();
}

/** A top-level element outside the billing element's subtree. */
async function addLooseElement(f: Fixture, project: Project) {
  const id = `${project.projectId}-loose`;
  const root = await f.db
    .selectFrom("projectElement")
    .select("stateId")
    .where("id", "=", project.rootId)
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("projectElement")
    .values({
      id,
      projectId: project.projectId,
      readableId: `${project.projectId}-3`,
      sequence: 3,
      type: "Task",
      name: "Unbilled work",
      isBilling: false,
      stateId: root.stateId,
      companyId: f.companyId,
      createdBy: f.userId
    })
    .execute();
  return id;
}

/** Labor on an element, debited to Project WIP. */
async function postLabor(
  f: Fixture,
  project: Project,
  elementId: string,
  { hours, amount, postingDate }: { hours: number; amount: number; postingDate: string }
) {
  const [journalLineId] = await f.addJournalLines(
    [{ account: "wip", amount }],
    postingDate
  );
  const [row] = await f.post([
    {
      projectId: project.projectId,
      projectElementId: elementId,
      costType: "Labor",
      quantity: hours,
      amount,
      laborCategoryId: f.laborCategoryId,
      postingDate,
      journalLineId
    }
  ]);
  return row!;
}

async function close(f: Fixture, projectId: string) {
  return closeProject(f.db, {
    id: projectId,
    companyId: f.companyId,
    updatedBy: f.userId
  });
}

/** The close journal's lines by account, natural-balance signed. */
async function journalLines(f: Fixture, journalId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount", "documentType", "documentId"])
    .where("journalId", "=", journalId)
    .where("companyId", "=", f.companyId)
    .execute();
  return lines
    .map((line) => ({
      accountId: line.accountId,
      amount: Number(line.amount),
      documentType: line.documentType,
      documentId: line.documentId
    }))
    .sort((a, b) => a.amount - b.amount);
}

async function reliefs(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectCostRelief")
    .select([
      "projectLedgerId",
      "amount",
      "journalId",
      "revenueRecognitionScheduleId"
    ])
    .where("companyId", "=", f.companyId)
    .execute();
  return rows
    .map((row) => ({
      projectLedgerId: row.projectLedgerId,
      amount: Number(row.amount),
      journalId: row.journalId,
      scheduled: row.revenueRecognitionScheduleId !== null
    }))
    .sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId));
}

databaseTest(
  "closing a Contract project moves the WIP no contract line owns to cost of goods sold, each row once",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("close", "PC1");
      const first = await postLabor(f, project, project.childId, {
        hours: 10,
        amount: 600,
        postingDate: "2026-02-10"
      });
      await setStatus(f, project.projectId, "Technically Complete");

      const closed = await close(f, project.projectId);
      expect(closed.error).toBeNull();
      const journalId = closed.data!.journalId!;
      expect(journalId).toBeTruthy();
      expect(await journalLines(f, journalId)).toEqual([
        {
          accountId: f.account("wip"),
          amount: -600,
          documentType: "Project Close",
          documentId: project.projectId
        },
        {
          accountId: f.account("cogs"),
          amount: 600,
          documentType: "Project Close",
          documentId: project.projectId
        }
      ]);
      const journal = await f.db
        .selectFrom("journal")
        .select(["status", "sourceType"])
        .where("id", "=", journalId)
        .executeTakeFirstOrThrow();
      expect(journal.sourceType).toBe("Project Close");
      expect(journal.status).toBe("Posted");
      expect(await reliefs(f)).toEqual([
        { projectLedgerId: first.id, amount: 600, journalId, scheduled: false }
      ]);
      const status = await f.db
        .selectFrom("project")
        .select("status")
        .where("id", "=", project.projectId)
        .executeTakeFirstOrThrow();
      expect(status.status).toBe("Closed");

      // Reopened, 100.00 more, closed again: only the new row is relieved.
      await setStatus(f, project.projectId, "Released");
      const second = await postLabor(f, project, project.childId, {
        hours: 1,
        amount: 100,
        postingDate: "2026-03-10"
      });
      await setStatus(f, project.projectId, "Technically Complete");
      const again = await close(f, project.projectId);
      expect(again.error).toBeNull();
      const secondJournalId = again.data!.journalId!;
      expect(secondJournalId).not.toBe(journalId);
      expect(
        (await journalLines(f, secondJournalId)).map((line) => line.amount)
      ).toEqual([-100, 100]);
      expect(await reliefs(f)).toEqual(
        [
          { projectLedgerId: first.id, amount: 600, journalId, scheduled: false },
          {
            projectLedgerId: second.id,
            amount: 100,
            journalId: secondJournalId,
            scheduled: false
          }
        ].sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId))
      );

      // Nothing left: a third close posts no journal.
      await setStatus(f, project.projectId, "Technically Complete");
      const third = await close(f, project.projectId);
      expect(third.error).toBeNull();
      expect(third.data!.journalId).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a row a Right to Invoice line owns is left for the revenue run, which relieves it once",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("owned", "PC2");
      const looseId = await addLooseElement(f, project);
      await f.addContract({
        key: "owned",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0
      });
      const owned = await postLabor(f, project, project.childId, {
        hours: 5,
        amount: 500,
        postingDate: "2026-09-10"
      });
      const loose = await postLabor(f, project, looseId, {
        hours: 3,
        amount: 300,
        postingDate: "2026-09-10"
      });
      await setStatus(f, project.projectId, "Technically Complete");

      const closed = await close(f, project.projectId);
      expect(closed.error).toBeNull();
      const journalId = closed.data!.journalId!;
      expect(
        (await journalLines(f, journalId)).map((line) => line.amount)
      ).toEqual([-300, 300]);
      expect(await reliefs(f)).toEqual([
        { projectLedgerId: loose.id, amount: 300, journalId, scheduled: false }
      ]);

      const proposal = await proposeRevenueRecognitionRun(f.service, {
        periodEnd: "2026-09-30"
      });
      expect(proposal?.id).toBeTruthy();
      expect(await reliefs(f)).toEqual(
        [
          { projectLedgerId: loose.id, amount: 300, journalId, scheduled: false },
          {
            projectLedgerId: owned.id,
            amount: 500,
            journalId: null,
            scheduled: true
          }
        ].sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId))
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "close refuses a project with project stock, a borrow not paid back, or an asset under construction",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const stocked = await f.addProject("stocked", "PC4");
      const borrower = await f.addProject("borrower", "PC5");
      const lender = await f.addProject("lender", "PC6");
      const capital = await f.addProject("capital", "PC7");
      for (const project of [stocked, borrower, lender, capital]) {
        await setStatus(f, project.projectId, "Technically Complete");
      }
      const itemId = await f.addStockedItem("part", {
        quantity: 10,
        unitCost: 5
      });

      // Stock in the project's stripe.
      await f.db
        .insertInto("itemLedger")
        .values({
          postingDate: "2026-02-01",
          entryType: "Positive Adjmt.",
          itemId,
          locationId: f.locationId,
          quantity: 4,
          projectId: stocked.projectId,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .execute();
      const stockRefusal = await close(f, stocked.projectId);
      expect(stockRefusal.error?.message).toMatch(/project stock/);

      // A borrow not paid back, from either side.
      const transfer = await f.db
        .insertInto("projectStockTransfer")
        .values({
          projectStockTransferId: "PST-1",
          type: "Borrow",
          status: "Posted",
          fromProjectId: lender.projectId,
          toProjectId: borrower.projectId,
          paybackDueDate: "2026-12-31",
          reason: "test",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const line = await f.db
        .insertInto("projectStockTransferLine")
        .values({
          projectStockTransferId: transfer.id,
          itemId,
          quantity: 1,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("projectBorrow")
        .values({
          borrowerProjectId: borrower.projectId,
          lenderProjectId: lender.projectId,
          projectStockTransferLineId: line.id,
          itemId,
          locationId: f.locationId,
          quantity: 1,
          borrowedUnitCost: 5,
          paybackDueDate: "2026-12-31",
          companyId: f.companyId,
          createdBy: f.userId
        })
        .execute();
      for (const project of [borrower, lender]) {
        const borrowRefusal = await close(f, project.projectId);
        expect(borrowRefusal.error?.message).toMatch(/not paid back/);
      }

      // A capital project's asset still under construction.
      const assetClass = await f.db
        .insertInto("fixedAssetClass")
        .values({
          name: "CIP",
          assetAccountId: f.account("wip"),
          accumulatedDepreciationAccountId: f.account("wip"),
          depreciationExpenseAccountId: f.account("expense"),
          gainOnDisposalAccountId: f.account("sales"),
          lossOnDisposalAccountId: f.account("expense"),
          writeDownAccountId: f.account("expense"),
          writeOffAccountId: f.account("expense"),
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const asset = await f.db
        .insertInto("fixedAsset")
        .values({
          fixedAssetId: "FA-1",
          fixedAssetClassId: assetClass.id,
          name: "Test stand",
          status: "Under Construction",
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .updateTable("project")
        .set({
          costTreatment: "Capitalize",
          fixedAssetClassId: assetClass.id,
          fixedAssetId: asset.id
        })
        .where("id", "=", capital.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      const assetRefusal = await close(f, capital.projectId);
      expect(assetRefusal.error?.message).toMatch(/under construction/);

      // None of them closed.
      const statuses = await f.db
        .selectFrom("project")
        .select("status")
        .where("companyId", "=", f.companyId)
        .where("id", "in", [
          stocked.projectId,
          borrower.projectId,
          lender.projectId,
          capital.projectId
        ])
        .execute();
      expect(statuses.every((row) => row.status === "Technically Complete")).toBe(
        true
      );
    } finally {
      await f.cleanup();
    }
  }
);
