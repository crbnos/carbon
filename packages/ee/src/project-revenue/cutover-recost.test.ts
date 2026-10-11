// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The accounting enable re-costs a Project Issue posted after the cutover.
// Cost Plus billing and the project cost summary read the project ledger,
// so both show the re-costed cost. The feature check reads the company's
// plan; it is the one stubbed boundary.

import {
  activationFixture,
  addReleasedProject,
  enableWithStockAtTen,
  type Fixture,
  moveBeforeCutover,
  receiveFiveParts,
  USER
} from "@carbon/server-functions/activate-accounting/activation-test-fixture";
import postProjectIssue from "@carbon/server-functions/post-project-issue";
import { databaseTest } from "@carbon/server-functions/test-fixture";
import { sql } from "kysely";
import { expect, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("../plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));

import { generateCostPlusItems } from "./service.server";

/** A Cost Plus line (fee 8 %) billing the project's element. */
async function costPlusLine(
  f: Fixture,
  args: { projectId: string; elementId: string }
) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const contract = await trx
      .insertInto("customerContract")
      .values({
        customerContractId: "CON-1",
        name: "Cost Plus",
        customerId: f.customerId,
        status: "Active",
        closeDate: f.beforeCutover,
        startDate: f.beforeCutover,
        endDate: f.today,
        billingFrequency: "Month",
        billingAlignment: "Calendar",
        billingTiming: "Arrears",
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("customerContractLine")
      .values({
        customerContractId: contract.id,
        revenueType: "One-time",
        itemId: f.serviceId,
        description: "Cost Plus",
        quantity: 1,
        rate: 0,
        startDate: f.beforeCutover,
        billingMethod: "Cost Plus",
        revenueMethod: "Right to Invoice",
        feePercent: 0.08,
        projectId: args.projectId,
        projectElementId: args.elementId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}

databaseTest(
  "Cost Plus billing and the project cost summary show a Project Issue's re-costed cost",
  async () => {
    const f = await activationFixture();
    try {
      // 5 at 8.00 and 5 at 12.00 before the cutover; it opens 10 at 10.00.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const { projectId, elementId } = await addReleasedProject(f, {
        costTreatment: "Contract"
      });
      await costPlusLine(f, { projectId, elementId });

      // After the cutover 5 go to the project from the 8.00 layer: 40.00.
      const issued = await postProjectIssue(f.ctx, {
        projectId,
        projectElementId: elementId,
        itemId: f.partId,
        locationId: f.locationId,
        quantity: 5,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toBe(40);

      // Against the opening layer the 5 cost 50.00.
      await enableWithStockAtTen(f);

      const { rows: summary } = await sql<{ actual: number }>`
        SELECT coalesce(sum("actual"), 0) AS "actual"
        FROM get_project_cost_summary(${projectId}, ${f.companyId})
      `.execute(f.db);
      expect(Number(summary[0]?.actual)).toBe(50);

      const generated = await generateCostPlusItems(f.db, {
        companyId: f.companyId,
        userId: USER,
        through: f.today
      });
      expect(generated).toEqual({ generated: 2, gated: false });
      const items = await f.db
        .selectFrom("projectBillableItem")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("projectId", "=", projectId)
        .orderBy("amount", "desc")
        .execute();
      // cost × 1.08: 40.00 → 43.20, and the 10.00 re-cost → 10.80.
      expect(items.map((item) => Number(item.amount))).toEqual([43.2, 10.8]);
    } finally {
      await f.cleanup();
    }
  }
);
