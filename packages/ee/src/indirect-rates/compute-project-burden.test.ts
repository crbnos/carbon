// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The burden run and the burden billing run against the local database. The
// feature check reads the company's plan; it is the one stubbed boundary.

import { projectBillingTestFixture } from "@carbon/server-functions/lib/project-billing-test-fixture";
import { databaseTest } from "@carbon/server-functions/test-fixture";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, vi } from "vitest";

vi.mock("../plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));

import {
  BURDEN_PERIOD_NOT_LOCKED,
  computeBurdenBilling,
  computeProjectBurden
} from "./service.server";

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
  return {
    f,
    project,
    lineId,
    poolId: pool.id,
    periodId: period.id,
    setRate,
    args
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
