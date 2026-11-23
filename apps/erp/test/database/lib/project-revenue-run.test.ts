// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The revenue recognition run over Right to Invoice lines, end to end: a run
// that holds Cost Relief rows posts; an ended line and its follow-on on one
// billing element share no ledger row; an earlier month run after a later one
// recognizes nothing again. Audit `.ai/runs/2026-10-22-project-accounting-audit.md`
// (A1, A2, A3).

import { expect } from "vitest";
import {
  postRevenueRecognitionRun,
  proposeRevenueRecognitionRun
} from "../../../app/modules/accounting/accounting.service";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";
import { dropRecognitionRuns } from "../fixtures/run";

type Fixture = Awaited<ReturnType<typeof projectBillingTestFixture>>;

/** The proposal on the system's service context, so a failure surfaces
 *  with its own message. */
async function propose(f: Fixture, periodEnd: string) {
  const proposal = await proposeRevenueRecognitionRun(f.service, {
    periodEnd
  });
  return proposal?.id ?? null;
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

/** Material cost on the billing element in Project WIP, one row per entry. */
async function postMaterial(
  f: Fixture,
  project: { projectId: string; rootId: string },
  entries: { amount: number; postingDate: string }[]
) {
  const rows = [];
  for (const entry of entries) {
    const [journalLineId] = await f.addJournalLines(
      [{ account: "wip", amount: entry.amount }],
      entry.postingDate
    );
    const [row] = await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.rootId,
        costType: "Material",
        amount: entry.amount,
        postingDate: entry.postingDate,
        journalLineId
      }
    ]);
    rows.push(row!);
  }
  return rows;
}

/** Each relieved ledger row with the line its Cost Relief row is on. */
async function reliefsByLine(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectCostRelief as r")
    .innerJoin("revenueRecognitionSchedule as s", (join) =>
      join
        .onRef("s.id", "=", "r.revenueRecognitionScheduleId")
        .onRef("s.companyId", "=", "r.companyId")
    )
    .select(["r.projectLedgerId", "r.amount", "s.customerContractLineId"])
    .where("r.companyId", "=", f.companyId)
    .execute();
  return rows
    .map((row) => ({
      projectLedgerId: row.projectLedgerId,
      amount: Number(row.amount),
      lineId: row.customerContractLineId
    }))
    .sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId));
}

async function months(f: Fixture) {
  const rows = await f.db
    .selectFrom("customerContractRevenue")
    .select(["customerContractLineId", "periodStart", "amount"])
    .where("companyId", "=", f.companyId)
    .execute();
  return rows
    .map((row) => ({
      lineId: row.customerContractLineId,
      periodStart: String(row.periodStart),
      amount: Number(row.amount)
    }))
    .sort((a, b) =>
      `${a.periodStart}${a.lineId}`.localeCompare(`${b.periodStart}${b.lineId}`)
    );
}

databaseTest(
  "a run holding a Cost Relief row posts, and its journal moves the cost from WIP to cost of goods sold",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("post", "P201");
      await f.addContract({
        key: "post",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.25
      });
      await postMaterial(f, project, [
        { amount: 1600, postingDate: "2026-09-10" }
      ]);
      const runId = await propose(f, "2026-09-30");
      expect(runId).not.toBeNull();

      const period = await f.db
        .insertInto("accountingPeriod")
        .values({
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          companyId: f.companyId,
          createdBy: f.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const posted = await postRevenueRecognitionRun(f.db, {
        runId: runId!,
        companyId: f.companyId,
        userId: f.userId,
        periods: new Map([
          [
            "2026-09-30",
            { accountingPeriodId: period.id, postingDate: "2026-09-30" }
          ]
        ]),
        dimensionIds: {}
      });

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", posted.journalId)
        .where("companyId", "=", f.companyId)
        .execute();
      const byAccount = (accountId: string) =>
        lines
          .filter((line) => line.accountId === accountId)
          .map((line) => Number(line.amount))
          .sort((a, b) => a - b);
      // Dr cost of goods sold / Cr Project WIP for the relieved cost.
      expect(byAccount(f.account("cogs"))).toEqual([1600]);
      expect(byAccount(f.account("wip"))).toEqual([-1600]);

      const relief = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("status")
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Cost Relief")
        .executeTakeFirstOrThrow();
      expect(relief.status).toBe("Posted");
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "an ended line and its follow-on on one billing element each recognize and relieve only the cost of their own dates",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("follow", "P202");
      const ended = await f.addContract({
        key: "ended",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      const next = await f.addContract({
        key: "next",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      await setLineDates(f, ended.lineId, {
        startDate: "2026-01-01",
        endDate: "2026-08-31"
      });
      await setLineDates(f, next.lineId, {
        startDate: "2026-09-01",
        endDate: null
      });
      const [august, september] = await postMaterial(f, project, [
        { amount: 1000, postingDate: "2026-08-20" },
        { amount: 2000, postingDate: "2026-09-10" }
      ]);

      // No August run: both rows are unrelieved when September runs.
      const runId = await propose(f, "2026-09-30");
      expect(runId).not.toBeNull();

      expect(await reliefsByLine(f)).toEqual(
        [
          { projectLedgerId: august!.id, amount: 1000, lineId: ended.lineId },
          { projectLedgerId: september!.id, amount: 2000, lineId: next.lineId }
        ].sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId))
      );
      expect(await months(f)).toEqual(
        [
          { lineId: ended.lineId, periodStart: "2026-09-01", amount: 1100 },
          { lineId: next.lineId, periodStart: "2026-09-01", amount: 2200 }
        ].sort((a, b) => a.lineId.localeCompare(b.lineId))
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "running an earlier month after a later month has a row recognizes nothing again",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("order", "P203");
      const { lineId } = await f.addContract({
        key: "order",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      await postMaterial(f, project, [
        { amount: 1000, postingDate: "2026-09-10" },
        { amount: 2000, postingDate: "2026-10-10" }
      ]);

      // October first: its cumulative month covers September's work.
      expect(await propose(f, "2026-10-31")).not.toBeNull();
      expect(await months(f)).toEqual([
        { lineId, periodStart: "2026-10-01", amount: 3300 }
      ]);

      await propose(f, "2026-09-30");
      expect(await months(f)).toEqual([
        { lineId, periodStart: "2026-10-01", amount: 3300 }
      ]);
      const september = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("periodStart", "=", "2026-09-01")
        .execute();
      expect(september).toEqual([]);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a single line owns the cost of its subtree posted before it started, so none is left in WIP",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("early", "P204");
      const { lineId } = await f.addContract({
        key: "early",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      await setLineDates(f, lineId, { startDate: "2026-09-01", endDate: null });
      const [early, inside] = await postMaterial(f, project, [
        { amount: 1000, postingDate: "2026-08-20" },
        { amount: 2000, postingDate: "2026-09-10" }
      ]);

      expect(await propose(f, "2026-09-30")).not.toBeNull();
      expect(await reliefsByLine(f)).toEqual(
        [
          { projectLedgerId: early!.id, amount: 1000, lineId },
          { projectLedgerId: inside!.id, amount: 2000, lineId }
        ].sort((a, b) => a.projectLedgerId.localeCompare(b.projectLedgerId))
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
