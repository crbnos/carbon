// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { generateContractBillableItems } from "../../../app/modules/sales/sales.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";

databaseTest("the backfill bills the rows with no item, once", async () => {
  const f = await projectBillingTestFixture();
  try {
    const project = await f.addProject("bf", "BF");
    // Posted before the contract exists: the first row gets no item.
    const [first] = await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: 200,
        postingDate: "2026-01-15"
      }
    ]);
    const { lineId } = await f.addContract({
      key: "tm",
      projectId: project.projectId,
      projectElementId: project.rootId,
      materialHandlingPercent: 0.1
    });
    // Posted under the live line: posting writes this row's item.
    await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: 100,
        postingDate: "2026-02-15"
      }
    ]);
    expect(await f.items(project.projectId)).toHaveLength(1);

    const run = () =>
      invokePosting(
        handlesOf(f.ctx),
        "generate-contract-billable-items",
        {
          customerContractLineId: lineId,
          through: "2026-03-01"
        },
        generateContractBillableItems
      );
    const once = await run();
    expect(once.error).toBeNull();
    expect(once.data).toEqual({ generated: 1 });

    const items = await f.items(project.projectId);
    expect(items).toHaveLength(2);
    const backfilled = items.find((item) => item.projectLedgerId === first!.id);
    expect(Number(backfilled?.amount)).toBe(220);
    expect(backfilled?.customerContractLineId).toBe(lineId);

    const twice = await run();
    expect(twice.data).toEqual({ generated: 0 });
  } finally {
    await f.cleanup();
  }
});

databaseTest("the backfill skips the rows posted before the line starts", async () => {
  const f = await projectBillingTestFixture();
  try {
    const project = await f.addProject("pre", "PRE");
    // A Fixed Price line covered the element through February; a T&M line
    // takes over from March 1.
    const fixed = await f.addContract({
      key: "fp",
      projectId: project.projectId,
      projectElementId: project.rootId,
      billingMethod: "Fixed",
      revenueMethod: "Percent Complete"
    });
    const { lineId } = await f.addContract({
      key: "tm",
      projectId: project.projectId,
      projectElementId: project.rootId
    });
    await f.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await trx
        .updateTable("customerContractLine")
        .set({ endDate: "2026-02-28" })
        .where("id", "=", fixed.lineId)
        .execute();
      await trx
        .updateTable("customerContractLine")
        .set({ startDate: "2026-03-01" })
        .where("id", "=", lineId)
        .execute();
    });

    // Cost the Fixed Price line covered: no T&M item at posting.
    const [covered] = await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: 200,
        postingDate: "2026-02-15"
      }
    ]);
    // A February row reversed in March: neither has an item, so the pair
    // must not bill, and the reversal must not credit.
    const [reversed] = await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: 50,
        postingDate: "2026-02-20"
      }
    ]);
    await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: -50,
        postingDate: "2026-03-05",
        reversalOfId: reversed!.id
      }
    ]);
    // Cost under the T&M line: posting writes its item.
    await f.post([
      {
        projectId: project.projectId,
        projectElementId: project.childId,
        costType: "Material",
        amount: 100,
        postingDate: "2026-03-10"
      }
    ]);
    expect(await f.items(project.projectId)).toHaveLength(1);

    const result = await invokePosting(
      handlesOf(f.ctx),
      "generate-contract-billable-items",
      {
        customerContractLineId: lineId,
        through: "2026-03-31"
      },
      generateContractBillableItems
    );
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ generated: 0 });

    const items = await f.items(project.projectId);
    expect(items).toHaveLength(1);
    expect(items.some((item) => item.projectLedgerId === covered!.id)).toBe(
      false
    );
    expect(Number(items[0]?.amount)).toBe(110);
  } finally {
    await f.cleanup();
  }
});

databaseTest("a Cost Plus line is refused", async () => {
  const f = await projectBillingTestFixture();
  try {
    const project = await f.addProject("cp", "CP");
    const { lineId } = await f.addContract({
      key: "cp",
      projectId: project.projectId,
      projectElementId: project.rootId,
      billingMethod: "Cost Plus"
    });
    const result = await invokePosting(
      handlesOf(f.ctx),
      "generate-contract-billable-items",
      {
        customerContractLineId: lineId,
        through: "2026-03-01"
      },
      generateContractBillableItems
    );
    expect(result.error?.message).toContain(
      "Cost Plus items come from the Project Revenue feature"
    );
  } finally {
    await f.cleanup();
  }
});
