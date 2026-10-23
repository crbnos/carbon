// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Right to Invoice synthesizer through the real proposal: the spec's
// Phase 4b case, a rebuilt month, and a write-off catch-up.
import { expect } from "vitest";
import { proposeRevenueRecognitionRun } from "../../../app/modules/accounting/accounting.service";
import { reverseProjectLedgerRows } from "../../../app/modules/projects/project-posting";
import { createProjectBillingInvoices } from "../../../app/modules/sales/sales.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";
import { dropRecognitionRuns } from "../fixtures/run";

type Fixture = Awaited<ReturnType<typeof projectBillingTestFixture>>;

async function propose(f: Fixture, periodEnd: string) {
  const result = await invokePosting(
    handlesOf(f.ctx),
    "propose-revenue-recognition-run",
    { periodEnd },
    proposeRevenueRecognitionRun
  );
  if (result.error) throw result.error;
  if (!result.data) throw new Error(`Nothing was proposed for ${periodEnd}`);
  return result.data.id;
}

/** The run's rows, ordered for comparison. */
async function runRows(f: Fixture, runId: string) {
  const rows = await f.db
    .selectFrom("revenueRecognitionRunLine as l")
    .innerJoin("revenueRecognitionSchedule as s", (join) =>
      join
        .onRef("s.id", "=", "l.scheduleId")
        .onRef("s.companyId", "=", "l.companyId")
    )
    .select([
      "s.id",
      "s.type",
      "s.amount",
      "s.debitAccountId",
      "s.creditAccountId",
      "s.customerContractRevenueId"
    ])
    .where("l.runId", "=", runId)
    .where("l.companyId", "=", f.companyId)
    .execute();
  return rows
    .map((row) => ({
      type: row.type,
      amount: Number(row.amount),
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Deletes a Draft run the way `deleteRevenueRecognitionRun` does: release
 *  its rows, then delete its lines and the run. */
async function deleteDraftRun(f: Fixture, runId: string) {
  await f.db.transaction().execute(async (trx) => {
    const lines = await trx
      .selectFrom("revenueRecognitionRunLine")
      .select("id")
      .where("runId", "=", runId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .updateTable("revenueRecognitionSchedule")
      .set({ runLineId: null })
      .where("companyId", "=", f.companyId)
      .where(
        "runLineId",
        "in",
        lines.map((line) => line.id)
      )
      .execute();
    await trx
      .deleteFrom("revenueRecognitionRunLine")
      .where("runId", "=", runId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .deleteFrom("revenueRecognitionRun")
      .where("id", "=", runId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

/** Sorted in JS, not by `ORDER BY`: the database's collation orders the
 *  mixed-case ids differently from the JS `.sort()` the tests compare with. */
async function reliefs(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectCostRelief")
    .select(["projectLedgerId", "amount"])
    .where("companyId", "=", f.companyId)
    .execute();
  return rows.sort((a, b) =>
    a.projectLedgerId < b.projectLedgerId
      ? -1
      : a.projectLedgerId > b.projectLedgerId
        ? 1
        : 0
  );
}

/**
 * September: 40 h of Engineer II (cost 3,100.00, billed at 150.00 an hour =
 * 6,000.00) and two material issues (cost 1,600.00 and 800.00, handling 25 %
 * = 2,000.00 and 1,000.00). Items 9,000.00, cost 5,500.00 in Project WIP. The
 * labor item is invoiced, so the line's position holds 6,000.00 of Deferred
 * Revenue.
 */
async function septemberWork(f: Fixture) {
  await f.addAccounting();
  const project = await f.addProject("rti", "P101");
  const { contractId, lineId } = await f.addContract({
    key: "rti",
    projectId: project.projectId,
    projectElementId: project.rootId,
    materialHandlingPercent: 0.25
  });
  const [labor, materialA, materialB, expensed] = await f.addJournalLines(
    [
      { account: "wip", amount: 3100 },
      { account: "wip", amount: 1600 },
      { account: "wip", amount: 800 },
      { account: "expense", amount: 400 }
    ],
    "2026-09-10"
  );
  const rows = await f.post([
    {
      projectId: project.projectId,
      projectElementId: project.childId,
      costType: "Labor",
      amount: 3100,
      quantity: 40,
      laborCategoryId: f.laborCategoryId,
      postingDate: "2026-09-10",
      journalLineId: labor
    },
    {
      projectId: project.projectId,
      projectElementId: project.childId,
      costType: "Material",
      amount: 1600,
      postingDate: "2026-09-10",
      journalLineId: materialA
    },
    {
      projectId: project.projectId,
      projectElementId: project.rootId,
      costType: "Material",
      amount: 800,
      postingDate: "2026-09-10",
      journalLineId: materialB
    },
    // Expensed, not in WIP (R4): never relieved.
    {
      projectId: project.projectId,
      projectElementId: project.rootId,
      costType: "Overhead",
      amount: 400,
      postingDate: "2026-09-10",
      journalLineId: expensed
    },
    // Accounting off: no journal line, nothing in WIP.
    {
      projectId: project.projectId,
      projectElementId: project.rootId,
      costType: "Machine",
      amount: 250,
      postingDate: "2026-09-10"
    }
  ]);
  const items = await f.items(project.projectId);
  expect(
    items.map((item) => Number(item.amount)).sort((a, b) => b - a)
  ).toEqual([6000, 2000, 1000]);

  // The invoice billed the labor item: the item is Billed, and the posting
  // raised the line's position by 6,000.00 into Deferred Revenue.
  const laborItem = items.find((item) => Number(item.amount) === 6000)!;
  await f.db
    .updateTable("projectBillableItem")
    .set({ status: "Billed" })
    .where("id", "=", laborItem.id)
    .where("companyId", "=", f.companyId)
    .execute();
  await f.db
    .insertInto("customerContractLedgerEntry")
    .values({
      companyId: f.companyId,
      customerContractId: contractId,
      customerContractLineId: lineId,
      entryType: "Invoice",
      postingDate: "2026-09-30",
      deferredAmount: 6000,
      deferredBase: 6000,
      createdBy: f.userId
    })
    .execute();

  return { project, lineId, rows, items };
}

databaseTest(
  "Right to Invoice recognizes the work performed and relieves its WIP cost",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const { rows } = await septemberWork(f);
      const runId = await propose(f, "2026-09-30");

      expect(await runRows(f, runId)).toEqual([
        {
          type: "Accrual",
          amount: 3000,
          debitAccountId: f.account("contract-asset"),
          creditAccountId: f.account("sales")
        },
        {
          type: "Cost Relief",
          amount: 5500,
          debitAccountId: f.account("cogs"),
          creditAccountId: f.account("wip")
        },
        {
          type: "Deferral",
          amount: 6000,
          debitAccountId: f.account("deferred"),
          creditAccountId: f.account("sales")
        }
      ]);

      const month = await f.db
        .selectFrom("customerContractRevenue")
        .select(["amount", "earnedToDate", "progress", "estimateAtCompletion"])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(month.amount)).toBe(9000);
      expect(Number(month.earnedToDate)).toBe(9000);
      expect(month.progress).toBeNull();
      expect(month.estimateAtCompletion).toBeNull();

      // The three WIP rows, once each; the expensed and journal-less rows not.
      const wipRows = rows
        .slice(0, 3)
        .map((row) => row.id)
        .sort();
      expect((await reliefs(f)).map((r) => r.projectLedgerId)).toEqual(wipRows);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "proposing a month again after deleting its Draft run rebuilds the same rows and relieves each ledger row once",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await septemberWork(f);
      const first = await propose(f, "2026-09-30");
      const before = await runRows(f, first);
      const reliefBefore = await reliefs(f);

      await deleteDraftRun(f, first);
      const second = await propose(f, "2026-09-30");

      expect(await runRows(f, second)).toEqual(before);
      expect(await reliefs(f)).toEqual(reliefBefore);
      const months = await f.db
        .selectFrom("customerContractRevenue")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(months.map((m) => Number(m.amount))).toEqual([9000]);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a write-off the next month recognizes a negative month",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const { items } = await septemberWork(f);
      await propose(f, "2026-09-30");

      const thousand = items.find((item) => Number(item.amount) === 1000)!;
      await f.db
        .updateTable("projectBillableItem")
        .set({ status: "Written Off", statusReason: "Goodwill" })
        .where("id", "=", thousand.id)
        .where("companyId", "=", f.companyId)
        .execute();

      const october = await propose(f, "2026-10-31");
      // September left 3,000.00 in Contract Assets; the catch-up draws on it.
      expect(await runRows(f, october)).toEqual([
        {
          type: "Accrual",
          amount: -1000,
          debitAccountId: f.account("contract-asset"),
          creditAccountId: f.account("sales")
        }
      ]);
      const month = await f.db
        .selectFrom("customerContractRevenue")
        .select(["amount", "earnedToDate"])
        .where("companyId", "=", f.companyId)
        .where("periodStart", "=", "2026-10-01")
        .executeTakeFirstOrThrow();
      expect(Number(month.amount)).toBe(-1000);
      expect(Number(month.earnedToDate)).toBe(8000);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a void after the run relieved a cost relieves its reversal in the next run",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("rtv", "P102");
      await f.addContract({
        key: "rtv",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.25
      });
      const [original] = await f.addJournalLines(
        [{ account: "wip", amount: 1600 }],
        "2026-09-10"
      );
      const [row] = await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.rootId,
          costType: "Material",
          amount: 1600,
          postingDate: "2026-09-10",
          journalLineId: original
        }
      ]);

      // September relieves the cost from WIP.
      await propose(f, "2026-09-30");
      expect(
        (await reliefs(f)).map((r) => [r.projectLedgerId, Number(r.amount)])
      ).toEqual([[row!.id, 1600]]);

      // The void: its journal negates the line, and the reversal row names it.
      const [voidLine] = await f.addJournalLines(
        [{ account: "wip", amount: -1600 }],
        "2026-10-05"
      );
      await f.db.transaction().execute((trx) =>
        reverseProjectLedgerRows(trx, {
          companyId: f.companyId,
          documentType: row!.documentType,
          documentId: row!.documentId,
          postingDate: "2026-10-05",
          userId: f.userId,
          reversalLineIds: new Map([[original!, voidLine!]])
        })
      );
      const reversal = await f.db
        .selectFrom("projectLedger")
        .select(["id", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .where("reversalOfId", "=", row!.id)
        .executeTakeFirstOrThrow();
      expect(reversal.journalLineId).toBe(voidLine);

      // October relieves the reversal: WIP gets the 1,600.00 back.
      const october = await propose(f, "2026-10-31");
      expect(
        (await runRows(f, october)).filter((r) => r.type === "Cost Relief")
      ).toEqual([
        {
          type: "Cost Relief",
          amount: -1600,
          debitAccountId: f.account("cogs"),
          creditAccountId: f.account("wip")
        }
      ]);
      expect(
        (await reliefs(f))
          .map((r) => [r.projectLedgerId, Number(r.amount)])
          .sort()
      ).toEqual(
        [
          [row!.id, 1600],
          [reversal.id, -1600]
        ].sort()
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

/**
 * Burden (Government Contracting 5b) on the September work: a memo Burden
 * row of 500.00 with no journal line, a burden item of 700.00 dated
 * 2026-09-30 and one of 300.00 dated 2026-10-31. Burden items have no ledger
 * row.
 */
async function septemberBurden(f: Fixture) {
  const work = await septemberWork(f);
  const pool = await f.db
    .insertInto("indirectPool")
    .values({
      name: "Overhead",
      poolType: "Overhead",
      sequence: 1,
      baseType: "Direct Labor Dollars",
      companyId: f.companyId,
      createdBy: f.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const burdenRow = await f.db
    .insertInto("projectLedger")
    .values({
      companyId: f.companyId,
      projectId: work.project.projectId,
      projectElementId: work.project.rootId,
      postingDate: "2026-09-30",
      costType: "Burden",
      documentType: "Indirect Burden",
      documentId: "burden-run",
      amount: 500,
      unallowable: false,
      indirectPoolId: pool.id,
      indirectRateType: "Provisional",
      burdenFiscalYear: 2026,
      createdBy: f.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("projectBillableItem")
    .values(
      (
        [
          [700, "2026-09-30"],
          [300, "2026-10-31"]
        ] as const
      ).map(([amount, postingDate]) => ({
        companyId: f.companyId,
        projectId: work.project.projectId,
        projectElementId: work.project.rootId,
        projectLedgerId: null,
        customerContractLineId: work.lineId,
        indirectPoolId: pool.id,
        fiscalYear: 2026,
        burdenRate: 0.25,
        burdenBase: amount * 4,
        postingDate,
        description: "Overhead FY2026 at 25%",
        quantity: 1,
        unitPrice: amount,
        amount,
        status: "Unbilled" as const,
        createdBy: f.userId
      }))
    )
    .execute();
  return { ...work, burdenRowId: burdenRow.id };
}

databaseTest(
  "Right to Invoice counts a burden item by its own posting date",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await septemberBurden(f);
      await propose(f, "2026-09-30");

      // 9,000.00 of items plus the 700.00 burden item of September; the
      // October burden item waits for October.
      const month = await f.db
        .selectFrom("customerContractRevenue")
        .select(["amount", "earnedToDate"])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(month.amount)).toBe(9700);
      expect(Number(month.earnedToDate)).toBe(9700);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a memo Burden row with no journal line gets no cost relief (5b decision B13)",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const { rows, burdenRowId } = await septemberBurden(f);
      await propose(f, "2026-09-30");

      const relieved = (await reliefs(f)).map((r) => r.projectLedgerId);
      expect(relieved).not.toContain(burdenRowId);
      expect(relieved).toEqual(
        rows
          .slice(0, 3)
          .map((row) => row.id)
          .sort()
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

/** The invoice run of the project billing lines, as the nightly job runs it. */
async function invoiceProjectBilling(f: Fixture, asOf: string) {
  const result = await invokePosting(
    handlesOf(f.ctx),
    "create-project-billing-invoices",
    { asOf },
    createProjectBillingInvoices
  );
  if (result.error) throw result.error;
  expect(result.data?.failures).toEqual([]);
  return result.data!;
}

databaseTest(
  "Right to Invoice earns no item held for the funding limit until funding covers it (audit A6)",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("fund", "P102");
      const { lineId } = await f.addContract({
        key: "fund",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0,
        fundedAmount: 1000
      });
      await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 1000,
          postingDate: "2026-02-10"
        },
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 200,
          postingDate: "2026-02-11"
        }
      ]);

      // February's invoice bills 1,000.00 and holds 200.00 for the funding.
      await invoiceProjectBilling(f, "2026-03-05");
      const held = (await f.items(project.projectId)).find(
        (item) => Number(item.amount) === 200
      )!;
      expect(held.statusReason).toBe("Funding limit");

      await propose(f, "2026-02-28");
      const february = await f.db
        .selectFrom("customerContractRevenue")
        .select(["amount", "earnedToDate"])
        .where("companyId", "=", f.companyId)
        .where("customerContractLineId", "=", lineId)
        .where("periodStart", "=", "2026-02-01")
        .executeTakeFirstOrThrow();
      expect(Number(february.earnedToDate)).toBe(1000);
      expect(Number(february.amount)).toBe(1000);

      // Funding covers the rest: the next invoice bills it, and the next
      // month earns it (cumulative).
      await f.db
        .updateTable("customerContractLine")
        .set({ fundedAmount: 1200 })
        .where("id", "=", lineId)
        .where("companyId", "=", f.companyId)
        .execute();
      await invoiceProjectBilling(f, "2026-04-05");
      const released = (await f.items(project.projectId)).find(
        (item) => item.id === held.id
      )!;
      expect(released.status).toBe("Billed");

      await propose(f, "2026-03-31");
      const march = await f.db
        .selectFrom("customerContractRevenue")
        .select(["amount", "earnedToDate"])
        .where("companyId", "=", f.companyId)
        .where("customerContractLineId", "=", lineId)
        .where("periodStart", "=", "2026-03-01")
        .executeTakeFirstOrThrow();
      expect(Number(march.earnedToDate)).toBe(1200);
      expect(Number(march.amount)).toBe(200);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
