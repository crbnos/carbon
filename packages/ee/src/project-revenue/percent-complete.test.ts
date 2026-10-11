// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The commercial Percent Complete synthesizer through the real revenue
// recognition proposal: the spec's Phase 4b cases (Percent Complete, the next
// month's catch-up, the ceiling, the loss provision), a rebuilt month that
// relieves each ledger row once, and the degrade without PROJECT_REVENUE.
// The feature check reads the company's plan; it is the one stubbed boundary.

import { projectBillingTestFixture } from "@carbon/server-functions/lib/project-billing-test-fixture";
import postProjectIssue from "@carbon/server-functions/post-project-issue";
import proposeRevenueRecognitionRun from "@carbon/server-functions/propose-revenue-recognition-run";
import { databaseTest } from "@carbon/server-functions/test-fixture";
import { datetime } from "@carbon/utils";
import { endOfMonth } from "@internationalized/date";
import { beforeEach, expect, vi } from "vitest";

const plan = vi.hoisted(() => ({ hasProjectRevenue: true }));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("../plan.server", () => ({
  companyHasFeature: vi.fn(async () => plan.hasProjectRevenue)
}));

import { projectRevenueSynthesizers } from "./service.server";

type Fixture = Awaited<ReturnType<typeof projectBillingTestFixture>>;

beforeEach(() => {
  plan.hasProjectRevenue = true;
});

async function fixture() {
  const f = await projectBillingTestFixture({
    revenueRunSynthesizers: projectRevenueSynthesizers
  });
  await f.addAccounting();
  return f;
}

async function cleanup(f: Fixture) {
  await f.db
    .deleteFrom("revenueRecognitionRun")
    .where("companyId", "=", f.companyId)
    .execute();
  await f.cleanup();
}

async function propose(f: Fixture, periodEnd: string) {
  const result = await proposeRevenueRecognitionRun(f.ctx, { periodEnd });
  if (result.error) throw result.error;
  return result.data?.id ?? null;
}

/** A project with a billing element and a Percent Complete line on it. The
 *  billing element's estimate at completion is the EAC. */
async function percentCompleteLine(
  f: Fixture,
  input: {
    key: string;
    billingMethod: "Fixed" | "Cost Plus";
    estimateAtCompletion: number;
    ceilingAmount?: number;
    scheduledTotal?: number;
  }
) {
  const project = await f.addProject(input.key, input.key.toUpperCase());
  const { contractId, lineId } = await f.addContract({
    key: input.key,
    projectId: project.projectId,
    projectElementId: project.rootId,
    billingMethod: input.billingMethod,
    revenueMethod: "Percent Complete",
    materialHandlingPercent: null,
    ceilingAmount: input.ceilingAmount ?? null
  });
  await setEstimate(f, project.rootId, input.estimateAtCompletion);
  if (input.scheduledTotal !== undefined) {
    // One Planned schedule row: the Fixed line's contract value.
    const invoice = await f.db
      .insertInto("customerContractInvoice")
      .values({
        companyId: f.companyId,
        customerContractId: contractId,
        invoiceDate: "2026-12-31",
        createdBy: f.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await f.db
      .insertInto("customerContractInvoiceLine")
      .values({
        companyId: f.companyId,
        customerContractId: contractId,
        customerContractInvoiceId: invoice.id,
        customerContractLineId: lineId,
        periodStart: "2026-12-01",
        periodEnd: "2026-12-31",
        units: 1,
        unitPrice: input.scheduledTotal,
        amount: input.scheduledTotal,
        createdBy: f.userId
      })
      .execute();
  }
  return { project, lineId };
}

async function setEstimate(
  f: Fixture,
  projectElementId: string,
  estimateAtCompletion: number
) {
  await f.db
    .updateTable("projectElement")
    .set({ estimateAtCompletion })
    .where("id", "=", projectElementId)
    .where("companyId", "=", f.companyId)
    .execute();
}

/** One material cost on the billing element, in Project WIP. */
async function postCost(
  f: Fixture,
  project: { projectId: string; rootId: string },
  amount: number,
  postingDate: string
) {
  const [journalLineId] = await f.addJournalLines(
    [{ account: "wip", amount }],
    postingDate
  );
  const [row] = await f.post([
    {
      projectId: project.projectId,
      projectElementId: project.rootId,
      costType: "Material",
      amount,
      postingDate,
      journalLineId
    }
  ]);
  return row!;
}

async function month(f: Fixture, periodStart: string) {
  const row = await f.db
    .selectFrom("customerContractRevenue")
    .select([
      "amount",
      "earnedToDate",
      "estimateAtCompletion",
      "transactionPrice",
      "progress"
    ])
    .where("companyId", "=", f.companyId)
    .where("periodStart", "=", periodStart)
    .executeTakeFirstOrThrow();
  return {
    amount: Number(row.amount),
    earnedToDate: Number(row.earnedToDate),
    estimateAtCompletion: Number(row.estimateAtCompletion),
    transactionPrice: Number(row.transactionPrice),
    progress: Number(row.progress)
  };
}

/** The run's schedule rows as `type → Σ amount`. */
async function runTotals(f: Fixture, runId: string) {
  const rows = await f.db
    .selectFrom("revenueRecognitionRunLine as l")
    .innerJoin("revenueRecognitionSchedule as s", (join) =>
      join
        .onRef("s.id", "=", "l.scheduleId")
        .onRef("s.companyId", "=", "l.companyId")
    )
    .select(["s.type", "s.amount", "s.debitAccountId", "s.creditAccountId"])
    .where("l.runId", "=", runId)
    .where("l.companyId", "=", f.companyId)
    .execute();
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.type] = (totals[row.type] ?? 0) + Number(row.amount);
  }
  return { totals, rows };
}

async function reliefs(f: Fixture) {
  return f.db
    .selectFrom("projectCostRelief")
    .select(["projectLedgerId", "amount"])
    .where("companyId", "=", f.companyId)
    .orderBy("projectLedgerId")
    .execute();
}

/** Deletes a Draft run the way `deleteRevenueRecognitionRun` does. */
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

databaseTest(
  "Percent Complete recognizes price × progress and relieves the WIP cost",
  async () => {
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pc1",
        billingMethod: "Cost Plus",
        estimateAtCompletion: 100000
      });
      await postCost(f, project, 25000, "2026-09-10");

      const runId = await propose(f, "2026-09-30");
      expect(runId).not.toBeNull();
      const { totals, rows } = await runTotals(f, runId!);
      expect(totals).toEqual({ Accrual: 27000, "Cost Relief": 25000 });
      const relief = rows.find((row) => row.type === "Cost Relief")!;
      expect(relief.debitAccountId).toBe(f.account("cogs"));
      expect(relief.creditAccountId).toBe(f.account("wip"));

      expect(await month(f, "2026-09-01")).toEqual({
        amount: 27000,
        earnedToDate: 27000,
        estimateAtCompletion: 100000,
        transactionPrice: 108000,
        progress: 0.25
      });
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest("the next month catches up to the new EAC and price", async () => {
  const f = await fixture();
  try {
    const { project } = await percentCompleteLine(f, {
      key: "pc2",
      billingMethod: "Cost Plus",
      estimateAtCompletion: 100000
    });
    await postCost(f, project, 25000, "2026-09-10");
    await propose(f, "2026-09-30");

    await postCost(f, project, 15000, "2026-10-05");
    await setEstimate(f, project.rootId, 120000);
    const runId = await propose(f, "2026-10-31");

    const { totals } = await runTotals(f, runId!);
    expect(totals).toEqual({ Accrual: 16200, "Cost Relief": 15000 });
    const october = await month(f, "2026-10-01");
    expect(october.amount).toBe(16200);
    expect(october.earnedToDate).toBe(43200);
    expect(october.transactionPrice).toBe(129600);
  } finally {
    await cleanup(f);
  }
});

databaseTest("the ceiling caps the Cost Plus price", async () => {
  const f = await fixture();
  try {
    const { project } = await percentCompleteLine(f, {
      key: "pc3",
      billingMethod: "Cost Plus",
      estimateAtCompletion: 100000,
      ceilingAmount: 115000
    });
    await postCost(f, project, 25000, "2026-09-10");
    await propose(f, "2026-09-30");
    expect((await month(f, "2026-09-01")).transactionPrice).toBe(108000);

    await postCost(f, project, 15000, "2026-10-05");
    await setEstimate(f, project.rootId, 120000);
    await propose(f, "2026-10-31");
    expect((await month(f, "2026-10-01")).transactionPrice).toBe(115000);
  } finally {
    await cleanup(f);
  }
});

databaseTest(
  "a forecast loss is provided in full and released at completion",
  async () => {
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pc4",
        billingMethod: "Fixed",
        estimateAtCompletion: 110000,
        scheduledTotal: 100000
      });
      await postCost(f, project, 44000, "2026-09-10");
      const september = await propose(f, "2026-09-30");

      const first = await runTotals(f, september!);
      expect(first.totals["Loss Provision"]).toBe(6000);
      const provision = first.rows.find(
        (row) => row.type === "Loss Provision"
      )!;
      expect(provision.debitAccountId).toBe(f.account("cogs"));
      expect(provision.creditAccountId).toBe(f.account("loss-provision"));
      expect(await month(f, "2026-09-01")).toMatchObject({
        amount: 40000,
        transactionPrice: 100000,
        progress: 0.4
      });

      await postCost(f, project, 66000, "2026-10-05");
      const october = await propose(f, "2026-10-31");
      const second = await runTotals(f, october!);
      expect(second.totals["Loss Provision"]).toBe(-6000);

      const balance = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Loss Provision")
        .execute();
      expect(balance.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "proposing a month again after deleting its Draft run relieves each ledger row once",
  async () => {
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pc5",
        billingMethod: "Cost Plus",
        estimateAtCompletion: 100000
      });
      const first = await postCost(f, project, 10000, "2026-09-10");
      const second = await postCost(f, project, 15000, "2026-09-20");

      const runId = await propose(f, "2026-09-30");
      const before = await reliefs(f);
      expect(before.map((relief) => relief.projectLedgerId)).toEqual(
        [first.id, second.id].sort()
      );

      await deleteDraftRun(f, runId!);
      const again = await propose(f, "2026-09-30");
      expect((await runTotals(f, again!)).totals).toEqual({
        Accrual: 27000,
        "Cost Relief": 25000
      });
      expect(await reliefs(f)).toEqual(before);
      const months = await f.db
        .selectFrom("customerContractRevenue")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(months.map((row) => Number(row.amount))).toEqual([27000]);
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "without PROJECT_REVENUE the run writes no Percent Complete month",
  async () => {
    plan.hasProjectRevenue = false;
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pc6",
        billingMethod: "Cost Plus",
        estimateAtCompletion: 100000
      });
      await postCost(f, project, 25000, "2026-09-10");
      await propose(f, "2026-09-30");

      const months = await f.db
        .selectFrom("customerContractRevenue")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(months).toEqual([]);
      expect(await reliefs(f)).toEqual([]);
      expect(await f.items(project.projectId)).toEqual([]);
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "a material issue to the Contract project is relieved from Project WIP",
  async () => {
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pc7",
        billingMethod: "Cost Plus",
        estimateAtCompletion: 1000
      });
      const itemId = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const issued = await postProjectIssue(f.ctx, {
        projectId: project.projectId,
        projectElementId: project.rootId,
        itemId,
        locationId: f.locationId,
        quantity: 5,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toBe(50);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["id", "journalLineId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .executeTakeFirstOrThrow();
      expect(ledger.journalLineId).not.toBeNull();

      // The issue posts today, so the run is for the current month.
      const periodEnd = endOfMonth(
        datetime.today("America/New_York")
      ).toString();
      const runId = await propose(f, periodEnd);
      expect(runId).not.toBeNull();
      const { totals, rows } = await runTotals(f, runId!);
      expect(totals["Cost Relief"]).toBe(50);
      const relief = rows.find((row) => row.type === "Cost Relief")!;
      expect(relief.debitAccountId).toBe(f.account("cogs"));
      expect(relief.creditAccountId).toBe(f.account("wip"));
      expect(await reliefs(f)).toEqual([
        { projectLedgerId: ledger.id, amount: expect.anything() }
      ]);
    } finally {
      await cleanup(f);
    }
  }
);
