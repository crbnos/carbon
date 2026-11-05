// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The burden run and the burden billing run against the local database. The
// feature check reads the company's plan; it is the one stubbed boundary.

import { registerPostings } from "@carbon/api/postings.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, vi } from "vitest";
import { postings } from "../../../../app/modules/postings.server";
import { databaseTest } from "../../fixtures/local-database";
import { projectBillingTestFixture } from "../../fixtures/project-billing";

vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));

import {
  BURDEN_PERIOD_NOT_LOCKED,
  computeBurdenBilling,
  computeProjectBurden
} from "@carbon/ee/indirect-rates.server";

// The burden run posts its rows through `post-project-burden`, which the app
// registers at start: the test registers the ERP's postings the same way.
registerPostings(postings);

// requireEntitlement passes the client to the stubbed feature check only.
const client = {} as SupabaseClient;

async function burdenFixture() {
  const f = await projectBillingTestFixture();
  const project = await f.addProject("burden", "BUR");
  await f.db
    .updateTable("project")
    .set({ costObjective: "Direct" })
    .where("id", "=", project.projectId)
    .where("companyId", "=", f.companyId)
    .execute();
  const { lineId } = await f.addContract({
    key: "cost-plus",
    projectId: project.projectId,
    projectElementId: project.rootId,
    billingMethod: "Cost Plus"
  });
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
  const period = await f.db
    .insertInto("accountingPeriod")
    .values({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      fiscalYear: 2026,
      periodNumber: 2,
      status: "Inactive",
      closeStatus: "Locked",
      companyId: f.companyId,
      createdBy: f.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const setRate = (
    rateType: "Provisional" | "Final",
    periodNumbers: number[],
    rate: number
  ) =>
    f.db
      .insertInto("indirectRate")
      .values(
        periodNumbers.map((periodNumber) => ({
          indirectPoolId: pool.id,
          fiscalYear: 2026,
          periodNumber,
          rateType,
          periodRate: rate,
          ytdRate: rate,
          companyId: f.companyId,
          createdBy: f.userId
        }))
      )
      .execute();

  const args = {
    companyId: f.companyId,
    userId: f.userId,
    accountingPeriodId: period.id
  };

  const addPeriod = async (
    startDate: string,
    endDate: string,
    fiscalYear: number,
    periodNumber: number
  ) => {
    const row = await f.db
      .insertInto("accountingPeriod")
      .values({
        startDate,
        endDate,
        fiscalYear,
        periodNumber,
        status: "Inactive",
        closeStatus: "Locked",
        companyId: f.companyId,
        createdBy: f.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ...args, accountingPeriodId: row.id };
  };

  const labor = (amount: number, postingDate: string) =>
    f.post([
      {
        projectId: project.projectId,
        projectElementId: project.rootId,
        costType: "Labor",
        amount,
        quantity: 1,
        postingDate
      }
    ]);

  const burdenRows = async () =>
    (
      await f.db
        .selectFrom("projectLedger")
        .select(["indirectRateType", "postingDate", "amount"])
        .where("companyId", "=", f.companyId)
        .where("costType", "=", "Burden")
        .orderBy("createdAt")
        .orderBy("postingDate")
        .execute()
    ).map((row) => ({ ...row, amount: Number(row.amount) }));

  return {
    f,
    project,
    lineId,
    poolId: pool.id,
    periodId: period.id,
    setRate,
    args,
    addPeriod,
    labor,
    burdenRows
  };
}

databaseTest(
  "the burden run posts the YTD catch-up once, and the billing run bills burden by difference",
  async () => {
    const b = await burdenFixture();
    try {
      await b.setRate("Provisional", [1, 2], 0.5);
      const [labor] = await b.f.post([
        {
          projectId: b.project.projectId,
          projectElementId: b.project.rootId,
          costType: "Labor",
          amount: 10000,
          quantity: 100
        }
      ]);
      // The Cost Plus item of the labor row (the billing base).
      await b.f.db
        .insertInto("projectBillableItem")
        .values({
          companyId: b.f.companyId,
          projectId: b.project.projectId,
          projectElementId: b.project.rootId,
          projectLedgerId: labor!.id,
          customerContractLineId: b.lineId,
          description: "Labor",
          quantity: 1,
          unitPrice: 10800,
          amount: 10800,
          status: "Unbilled",
          createdBy: b.f.userId
        })
        .execute();

      const burden = await computeProjectBurden(b.f.db, client, b.args);
      expect(burden.error).toBeNull();
      expect(burden.data?.burdenRowCount).toEqual(1);

      const rows = await b.f.db
        .selectFrom("projectLedger")
        .select([
          "projectElementId",
          "indirectPoolId",
          "indirectRateType",
          "burdenFiscalYear",
          "postingDate",
          "amount"
        ])
        .where("companyId", "=", b.f.companyId)
        .where("costType", "=", "Burden")
        .execute();
      expect(
        rows.map((row) => ({ ...row, amount: Number(row.amount) }))
      ).toEqual([
        {
          projectElementId: b.project.rootId,
          indirectPoolId: b.poolId,
          indirectRateType: "Provisional",
          burdenFiscalYear: 2026,
          postingDate: "2026-02-28",
          amount: 5000
        }
      ]);

      // A second run finds nothing to catch up.
      const again = await computeProjectBurden(b.f.db, client, b.args);
      expect(again.data?.burdenRowCount).toEqual(0);

      const run = await b.f.db
        .selectFrom("indirectRateRun")
        .select(["burdenRateType", "burdenRowCount", "burdenComputedAt"])
        .where("accountingPeriodId", "=", b.periodId)
        .where("companyId", "=", b.f.companyId)
        .executeTakeFirstOrThrow();
      expect(run.burdenRateType).toEqual("Provisional");
      expect(run.burdenComputedAt).not.toBeNull();

      // Billing: 10,000.00 of labor × 0.5 × (1 + 0.08 fee) = 5,400.00.
      const billed = await computeBurdenBilling(b.f.db, client, b.args);
      expect(billed.error).toBeNull();
      expect(billed.data?.billableItemCount).toEqual(1);

      // A Final rate of 0.45 bills the difference: 4,860.00 − 5,400.00.
      await b.setRate("Final", [1, 2], 0.45);
      const trueUp = await computeBurdenBilling(b.f.db, client, b.args);
      expect(trueUp.data?.billableItemCount).toEqual(1);

      const items = await b.f.db
        .selectFrom("projectBillableItem")
        .select([
          "projectLedgerId",
          "indirectPoolId",
          "fiscalYear",
          "burdenRate",
          "burdenBase",
          "postingDate",
          "amount",
          "status",
          "description"
        ])
        .where("companyId", "=", b.f.companyId)
        .where("indirectPoolId", "is not", null)
        .orderBy("amount", "desc")
        .execute();
      expect(
        items.map((item) => ({
          ...item,
          burdenRate: Number(item.burdenRate),
          burdenBase: Number(item.burdenBase),
          amount: Number(item.amount)
        }))
      ).toEqual([
        {
          projectLedgerId: null,
          indirectPoolId: b.poolId,
          fiscalYear: 2026,
          burdenRate: 0.5,
          burdenBase: 10000,
          postingDate: "2026-02-28",
          amount: 5400,
          status: "Unbilled",
          description: "Overhead FY2026 at 50%"
        },
        {
          projectLedgerId: null,
          indirectPoolId: b.poolId,
          fiscalYear: 2026,
          burdenRate: 0.45,
          burdenBase: 10000,
          postingDate: "2026-02-28",
          amount: -540,
          status: "Unbilled",
          description: "Overhead FY2026 at 45%"
        }
      ]);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest("the burden run refuses a period that is not Locked", async () => {
  const b = await burdenFixture();
  try {
    await b.f.db
      .updateTable("accountingPeriod")
      .set({ closeStatus: "Open" })
      .where("id", "=", b.periodId)
      .where("companyId", "=", b.f.companyId)
      .execute();
    const result = await computeProjectBurden(b.f.db, client, b.args);
    expect(result.data).toBeNull();
    expect(result.error?.message).toEqual(BURDEN_PERIOD_NOT_LOCKED);
  } finally {
    await b.f.cleanup();
  }
});

databaseTest("the burden run refuses a pool with no rate", async () => {
  const b = await burdenFixture();
  try {
    const result = await computeProjectBurden(b.f.db, client, b.args);
    expect(result.error?.message).toEqual(
      "No Provisional rate for Overhead in FY2026 period 2"
    );
  } finally {
    await b.f.cleanup();
  }
});

databaseTest(
  "re-running an earlier period posts only that period's correction and leaves later burden alone",
  async () => {
    const b = await burdenFixture();
    try {
      await b.setRate("Provisional", [1, 2], 0.5);
      const january = await b.addPeriod("2026-01-01", "2026-01-31", 2026, 1);
      await b.labor(10000, "2026-01-15");
      await b.labor(10000, "2026-02-10");

      expect((await computeProjectBurden(b.f.db, client, january)).error).toBeNull();
      expect((await computeProjectBurden(b.f.db, client, b.args)).error).toBeNull();

      // Nothing changed in January: re-running it posts nothing.
      const rerun = await computeProjectBurden(b.f.db, client, january);
      expect(rerun.error).toBeNull();
      expect(rerun.data?.burdenRowCount).toEqual(0);

      // Cost backdated into January: the re-run posts January's correction only.
      await b.labor(2000, "2026-01-20");
      const corrected = await computeProjectBurden(b.f.db, client, january);
      expect(corrected.data?.burdenRowCount).toEqual(1);
      expect(await b.burdenRows()).toEqual([
        { indirectRateType: "Provisional", postingDate: "2026-01-31", amount: 5000 },
        { indirectRateType: "Provisional", postingDate: "2026-02-28", amount: 5000 },
        { indirectRateType: "Provisional", postingDate: "2026-01-31", amount: 1000 }
      ]);

      // February is still whole: re-running it posts nothing.
      const february = await computeProjectBurden(b.f.db, client, b.args);
      expect(february.data?.burdenRowCount).toEqual(0);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest(
  "a Provisional re-run of period 12 after the Final true-up does not undo the true-up",
  async () => {
    const b = await burdenFixture();
    try {
      const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      await b.setRate("Provisional", periods, 0.5);
      await b.setRate("Final", [12], 0.4);
      const december = await b.addPeriod("2026-12-01", "2026-12-31", 2026, 12);
      const nextJanuary = await b.addPeriod("2027-01-01", "2027-01-31", 2027, 1);
      await b.labor(10000, "2026-12-10");

      expect((await computeProjectBurden(b.f.db, client, december)).error).toBeNull();
      const trueUp = await computeProjectBurden(b.f.db, client, {
        ...nextJanuary,
        rateType: "Final",
        fiscalYear: 2026
      });
      expect(trueUp.error).toBeNull();
      expect(trueUp.data?.burdenRowCount).toEqual(1);

      // Relocking December runs the Provisional catch-up again.
      const relock = await computeProjectBurden(b.f.db, client, december);
      expect(relock.data?.burdenRowCount).toEqual(0);

      // The true-up itself stays idempotent.
      const again = await computeProjectBurden(b.f.db, client, {
        ...nextJanuary,
        rateType: "Final",
        fiscalYear: 2026
      });
      expect(again.data?.burdenRowCount).toEqual(0);
      expect(await b.burdenRows()).toEqual([
        { indirectRateType: "Provisional", postingDate: "2026-12-31", amount: 5000 },
        { indirectRateType: "Final", postingDate: "2027-01-31", amount: -1000 }
      ]);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest(
  "a Provisional re-run of period 12 leaves a true-up posted into period 12 itself",
  async () => {
    const b = await burdenFixture();
    try {
      const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      await b.setRate("Provisional", periods, 0.5);
      await b.setRate("Final", [12], 0.4);
      const december = await b.addPeriod("2026-12-01", "2026-12-31", 2026, 12);
      await b.labor(10000, "2026-12-10");

      expect((await computeProjectBurden(b.f.db, client, december)).error).toBeNull();
      const trueUp = await computeProjectBurden(b.f.db, client, {
        ...december,
        rateType: "Final"
      });
      expect(trueUp.data?.burdenRowCount).toEqual(1);

      const relock = await computeProjectBurden(b.f.db, client, december);
      expect(relock.data?.burdenRowCount).toEqual(0);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest(
  "deactivating a pool keeps the burden it already posted, and its billing",
  async () => {
    const b = await burdenFixture();
    try {
      await b.setRate("Provisional", [1, 2], 0.5);
      await b.labor(10000, "2026-02-10");
      expect((await computeProjectBurden(b.f.db, client, b.args)).error).toBeNull();

      await b.f.db
        .updateTable("indirectPool")
        .set({ active: false })
        .where("id", "=", b.poolId)
        .where("companyId", "=", b.f.companyId)
        .execute();

      const rerun = await computeProjectBurden(b.f.db, client, b.args);
      expect(rerun.error).toBeNull();
      expect(rerun.data?.burdenRowCount).toEqual(0);
      expect(await b.burdenRows()).toEqual([
        { indirectRateType: "Provisional", postingDate: "2026-02-28", amount: 5000 }
      ]);
    } finally {
      await b.f.cleanup();
    }
  }
);
