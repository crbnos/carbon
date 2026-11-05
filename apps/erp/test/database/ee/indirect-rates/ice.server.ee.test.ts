// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Every ICE schedule against the local database: each reader runs its SQL,
// and Schedules A, B, G and H read the seeded values back. The feature check
// reads the company's plan; it is the one stubbed boundary.

import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, vi } from "vitest";
import { databaseTest } from "../../fixtures/local-database";
import { projectBillingTestFixture } from "../../fixtures/project-billing";

vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));

import { ICE_SCHEDULES } from "@carbon/ee/indirect-rates";
import { buildIceSchedule } from "@carbon/ee/indirect-rates.server";

// requireEntitlement passes the client to the stubbed feature check only.
const client = {} as SupabaseClient;

databaseTest(
  "every ICE schedule reads its year, and A, B, G and H show the seeded values",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      await f.addAccounting();
      const project = await f.addProject("ice", "ICE");
      await f.db
        .updateTable("project")
        .set({ costObjective: "Direct" })
        .where("id", "=", project.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.addContract({
        key: "ice",
        projectId: project.projectId,
        projectElementId: project.rootId,
        billingMethod: "Cost Plus"
      });
      const [wip] = await f.addJournalLines([
        { account: "wip", amount: 10000 }
      ]);
      await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.rootId,
          costType: "Labor",
          amount: 10000,
          quantity: 100,
          journalLineId: wip
        }
      ]);

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
      await f.db
        .insertInto("indirectRate")
        .values({
          indirectPoolId: pool.id,
          fiscalYear: 2026,
          periodNumber: 2,
          rateType: "Actual",
          periodRate: 0.5,
          ytdRate: 0.5,
          poolCost: 5000,
          unallowableCost: 0,
          baseAmount: 10000,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .execute();
      await f.db
        .insertInto("indirectExpenseStatement")
        .values({
          indirectPoolId: pool.id,
          fiscalYear: 2026,
          periodNumber: 2,
          lineType: "Account",
          accountId: f.account("expense"),
          amount: 5600,
          unallowableAmount: 600,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .execute();

      const tables = new Map<
        string,
        Awaited<ReturnType<typeof buildIceSchedule>>
      >();
      for (const schedule of ICE_SCHEDULES) {
        tables.set(
          schedule,
          await buildIceSchedule(f.db, client, {
            companyId: f.companyId,
            fiscalYear: 2026,
            schedule
          })
        );
      }

      expect(tables.get("A")?.rows).toEqual([
        ["Overhead", "Overhead", "Direct Labor Dollars", 10000, 5000, 0.5]
      ]);
      // Overhead is not a G&A pool: Schedule C lists its expenses, B none.
      expect(tables.get("B")?.rows).toEqual([]);
      expect(tables.get("C")?.rows).toEqual([
        ["Overhead", "", expect.stringContaining("expense"), 5600, 600, 5000]
      ]);
      expect(tables.get("E")?.rows).toEqual([["Overhead", "Labor", 10000]]);
      expect(tables.get("G")?.rows.at(-1)).toEqual(["Difference", 0]);
      expect(tables.get("H")?.rows).toEqual([
        ["CON-ice", expect.any(String), 10000, 0, 0, 0, 10000, 5000, 15000]
      ]);
      expect(tables.get("I")?.rows).toEqual([
        ["CON-ice", 15000, 0, 15000, 0, 15000]
      ]);
      expect(tables.get("K")?.rows).toEqual([]);
      expect(tables.get("L")?.rows).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
