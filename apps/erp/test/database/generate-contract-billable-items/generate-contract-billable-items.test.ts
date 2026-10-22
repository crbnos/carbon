// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
