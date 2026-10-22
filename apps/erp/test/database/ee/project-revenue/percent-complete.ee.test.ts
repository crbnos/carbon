// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The commercial Percent Complete synthesizer through the real revenue
// recognition proposal: the spec's Phase 4b cases (Percent Complete, the next
// month's catch-up, the ceiling, the loss provision), a rebuilt month that
// relieves each ledger row once, and the degrade without PROJECT_REVENUE.
// The feature check reads the company's plan; it is the one stubbed boundary.

import { datetime } from "@carbon/utils";
import { endOfMonth } from "@internationalized/date";
import { beforeEach, expect, vi } from "vitest";
import { generateCostPlusItems } from "@carbon/ee/project-revenue.server";
import {
  postRevenueRecognitionRun,
  proposeRevenueRecognitionRun
} from "../../../../app/modules/accounting/accounting.service";
import { postProjectIssue } from "../../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../../app/modules/shared/shared.service";
import { handlesOf } from "../../fixtures/handles";
import { databaseTest } from "../../fixtures/local-database";
import { projectBillingTestFixture } from "../../fixtures/project-billing";

const plan = vi.hoisted(() => ({ hasProjectRevenue: true }));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: vi.fn(async () => plan.hasProjectRevenue)
}));

type Fixture = Awaited<ReturnType<typeof projectBillingTestFixture>>;

beforeEach(() => {
  plan.hasProjectRevenue = true;
});

async function fixture() {
  // The revenue run always runs the commercial synthesizers
  // (`runRowSynthesizers`); the stubbed feature check decides whether they
  // write anything.
  const f = await projectBillingTestFixture();
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

/** The proposal on the system's service context, so a failure surfaces
 *  with its own message. */
async function propose(f: Fixture, periodEnd: string) {
  const proposal = await proposeRevenueRecognitionRun(f.service, {
    periodEnd
  });
  return proposal?.id ?? null;
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
    await addScheduledTotal(f, contractId, lineId, input.scheduledTotal);
  }
  return { project, lineId };
}

/** One Planned schedule row: a Fixed line's contract value. */
async function addScheduledTotal(
  f: Fixture,
  contractId: string,
  lineId: string,
  amount: number
) {
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
      unitPrice: amount,
      amount,
      createdBy: f.userId
    })
    .execute();
}

/** Sets a line's dates, as an amendment `end` and an added line do. */
async function setLineDates(
  f: Fixture,
  lineId: string,
  dates: { startDate: string; endDate: string | null }
) {
  await f.db
    .updateTable("customerContractLine")
    .set(dates)
    .where("id", "=", lineId)
    .where("companyId", "=", f.companyId)
    .execute();
}

/** Posts a Draft run in an accounting period of its month. */
async function postRun(
  f: Fixture,
  runId: string,
  month: { startDate: string; endDate: string }
) {
  const period = await f.db
    .insertInto("accountingPeriod")
    .values({ ...month, companyId: f.companyId, createdBy: f.userId })
    .returning("id")
    .executeTakeFirstOrThrow();
  return postRevenueRecognitionRun(f.db, {
    runId,
    companyId: f.companyId,
    userId: f.userId,
    periods: new Map([
      [
        month.endDate,
        { accountingPeriodId: period.id, postingDate: month.endDate }
      ]
    ]),
    dimensionIds: {}
  });
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
      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: project.projectId,
          projectElementId: project.rootId,
          itemId,
          locationId: f.locationId,
          quantity: 5,
          direction: "Issue"
        },
        postProjectIssue
      );
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

/** The month rows and schedule rows of a month, per line. */
async function monthRows(f: Fixture, periodStart: string) {
  const revenue = await f.db
    .selectFrom("customerContractRevenue")
    .select(["customerContractLineId", "amount"])
    .where("companyId", "=", f.companyId)
    .where("periodStart", "=", periodStart)
    .execute();
  const schedule = await f.db
    .selectFrom("revenueRecognitionSchedule")
    .select(["customerContractLineId", "type", "amount"])
    .where("companyId", "=", f.companyId)
    .where("periodStart", "=", periodStart)
    .execute();
  return {
    revenue: revenue.map((row) => ({
      lineId: row.customerContractLineId,
      amount: Number(row.amount)
    })),
    schedule: schedule.map((row) => ({
      lineId: row.customerContractLineId,
      type: row.type,
      amount: Number(row.amount)
    }))
  };
}

databaseTest(
  "an ended Percent Complete line and its follow-on on one element each earn and relieve only the cost of their own dates",
  async () => {
    const f = await fixture();
    try {
      const project = await f.addProject("pcf", "PCF");
      const ended = await f.addContract({
        key: "pcf-ended",
        projectId: project.projectId,
        projectElementId: project.rootId,
        billingMethod: "Fixed",
        revenueMethod: "Percent Complete",
        materialHandlingPercent: null
      });
      const next = await f.addContract({
        key: "pcf-next",
        projectId: project.projectId,
        projectElementId: project.rootId,
        billingMethod: "Fixed",
        revenueMethod: "Percent Complete",
        materialHandlingPercent: null
      });
      await setLineDates(f, ended.lineId, {
        startDate: "2026-01-01",
        endDate: "2026-08-31"
      });
      await setLineDates(f, next.lineId, {
        startDate: "2026-09-01",
        endDate: null
      });
      await addScheduledTotal(f, ended.contractId, ended.lineId, 30000);
      await addScheduledTotal(f, next.contractId, next.lineId, 40000);
      await setEstimate(f, project.rootId, 30000);
      const august = await postCost(f, project, 6000, "2026-08-20");
      const september = await postCost(f, project, 12000, "2026-09-10");

      // No August run: both rows are unrelieved when September runs.
      const runId = await propose(f, "2026-09-30");
      expect(runId).not.toBeNull();

      const relieved = await f.db
        .selectFrom("projectCostRelief as r")
        .innerJoin("revenueRecognitionSchedule as s", (join) =>
          join
            .onRef("s.id", "=", "r.revenueRecognitionScheduleId")
            .onRef("s.companyId", "=", "r.companyId")
        )
        .select(["r.projectLedgerId", "s.customerContractLineId"])
        .where("r.companyId", "=", f.companyId)
        .execute();
      expect(
        relieved
          .map((row) => [row.projectLedgerId, row.customerContractLineId])
          .sort()
      ).toEqual(
        [
          [august.id, ended.lineId],
          [september.id, next.lineId]
        ].sort()
      );

      // Each line's EAC leaves out the other line's cost: the ended line
      // 6,000 of 30,000 − 12,000; the follow-on 12,000 of 30,000 − 6,000.
      const { revenue } = await monthRows(f, "2026-09-01");
      expect(revenue.sort((a, b) => a.lineId!.localeCompare(b.lineId!))).toEqual(
        [
          { lineId: ended.lineId, amount: 10000 },
          { lineId: next.lineId, amount: 20000 }
        ].sort((a, b) => a.lineId.localeCompare(b.lineId))
      );
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "an amendment's change copy of a Fixed Percent Complete line carries the replaced line's months on",
  async () => {
    const f = await fixture();
    try {
      const { project, lineId } = await percentCompleteLine(f, {
        key: "pca",
        billingMethod: "Fixed",
        estimateAtCompletion: 100000,
        scheduledTotal: 100000
      });
      const september = await postCost(f, project, 40000, "2026-09-10");
      await propose(f, "2026-09-30");
      expect((await month(f, "2026-09-01")).amount).toBe(40000);

      // The amendment `change` of a One-time line: the old line ends the day
      // before it starts, and the copy starts on the same day at a new price.
      const line = await f.db
        .selectFrom("customerContractLine")
        .selectAll()
        .where("id", "=", lineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const amendment = await f.db
        .insertInto("customerContractAmendment")
        .values({
          customerContractId: line.customerContractId,
          amendmentDate: "2026-10-01",
          contractType: "Expansion",
          reason: "Scope added",
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const copyId = `${lineId}-copy`;
      await f.db
        .insertInto("customerContractLine")
        .values({
          ...line,
          id: copyId,
          amendmentId: amendment.id,
          amendsLineId: lineId,
          createdAt: undefined,
          updatedAt: undefined
        })
        .execute();
      await setLineDates(f, lineId, {
        startDate: "2026-01-01",
        endDate: "2025-12-31"
      });
      await addScheduledTotal(f, line.customerContractId, copyId, 120000);

      const october = await postCost(f, project, 10000, "2026-10-05");
      await propose(f, "2026-10-31");

      // 50 % of 120,000 is 60,000 earned; the replaced line recognized 40,000.
      const { revenue } = await monthRows(f, "2026-10-01");
      expect(revenue).toEqual([{ lineId: copyId, amount: 20000 }]);
      const relieved = await f.db
        .selectFrom("projectCostRelief as r")
        .innerJoin("revenueRecognitionSchedule as s", (join) =>
          join
            .onRef("s.id", "=", "r.revenueRecognitionScheduleId")
            .onRef("s.companyId", "=", "r.companyId")
        )
        .select(["r.projectLedgerId", "s.customerContractLineId"])
        .where("r.companyId", "=", f.companyId)
        .execute();
      expect(
        relieved
          .map((row) => [row.projectLedgerId, row.customerContractLineId])
          .sort()
      ).toEqual(
        [
          [september.id, lineId],
          [october.id, copyId]
        ].sort()
      );
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "running an earlier month after a later month has a row writes no revenue and no loss provision for it",
  async () => {
    const f = await fixture();
    try {
      const { project } = await percentCompleteLine(f, {
        key: "pco",
        billingMethod: "Fixed",
        estimateAtCompletion: 110000,
        scheduledTotal: 100000
      });
      await postCost(f, project, 44000, "2026-09-10");
      await postCost(f, project, 22000, "2026-10-10");

      // October first: 60 % complete, 60,000 earned, 4,000 of provision.
      await propose(f, "2026-10-31");
      const october = await monthRows(f, "2026-10-01");
      expect(october.revenue.map((row) => row.amount)).toEqual([60000]);
      expect(
        october.schedule
          .filter((row) => row.type === "Loss Provision")
          .map((row) => row.amount)
      ).toEqual([4000]);

      await propose(f, "2026-09-30");
      expect(await monthRows(f, "2026-09-01")).toEqual({
        revenue: [],
        schedule: []
      });
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "a second run in a month with no revenue books no more loss provision",
  async () => {
    const f = await fixture();
    try {
      await percentCompleteLine(f, {
        key: "pcl",
        billingMethod: "Fixed",
        estimateAtCompletion: 1200,
        scheduledTotal: 1000
      });
      const september = { startDate: "2026-09-01", endDate: "2026-09-30" };
      const first = await propose(f, september.endDate);
      expect((await runTotals(f, first!)).totals).toEqual({
        "Loss Provision": 200
      });
      await postRun(f, first!, september);

      await propose(f, september.endDate);
      const provisions = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Loss Provision")
        .execute();
      expect(provisions.map((row) => Number(row.amount))).toEqual([200]);
    } finally {
      await cleanup(f);
    }
  }
);

/** A Cost Plus line on a project's billing element, with these dates. */
async function costPlusLine(
  f: Fixture,
  key: string,
  identifier: string,
  dates: { startDate: string; endDate: string | null }
) {
  const project = await f.addProject(key, identifier);
  const { lineId } = await f.addContract({
    key,
    projectId: project.projectId,
    projectElementId: project.rootId,
    billingMethod: "Cost Plus",
    materialHandlingPercent: null
  });
  await setLineDates(f, lineId, dates);
  return { project, lineId };
}

databaseTest(
  "Cost Plus bills no row posted before the line starts",
  async () => {
    const f = await fixture();
    try {
      const { project } = await costPlusLine(f, "cpstart", "CPS", {
        startDate: "2026-09-01",
        endDate: null
      });
      await postCost(f, project, 1000, "2026-08-15");
      const september = await postCost(f, project, 2000, "2026-09-10");

      await generateCostPlusItems(f.db, {
        companyId: f.companyId,
        userId: f.userId,
        through: "2026-09-30"
      });
      const items = await f.items(project.projectId);
      expect(
        items.map((item) => [item.projectLedgerId, Number(item.amount)])
      ).toEqual([[september.id, 2160]]);
    } finally {
      await cleanup(f);
    }
  }
);

databaseTest(
  "an ended Cost Plus line still bills a row of its own dates generated after it ends",
  async () => {
    const f = await fixture();
    try {
      const { project } = await costPlusLine(f, "cpend", "CPE", {
        startDate: "2026-01-01",
        endDate: "2026-08-31"
      });
      const august = await postCost(f, project, 1000, "2026-08-20");
      await postCost(f, project, 2000, "2026-09-10");

      await generateCostPlusItems(f.db, {
        companyId: f.companyId,
        userId: f.userId,
        through: "2026-09-30"
      });
      const items = await f.items(project.projectId);
      expect(
        items.map((item) => [item.projectLedgerId, Number(item.amount)])
      ).toEqual([[august.id, 1080]]);
    } finally {
      await cleanup(f);
    }
  }
);
