// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A release picking list can have lines with no lineside destination: a pick
// takes it from the operation's work center at pick time.

import { expect } from "vitest";
import { postPicking as postPickingBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const postPicking = (ctx: Ctx, input: Parameters<typeof postPickingBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-picking", input, postPickingBody);

async function lineWithoutDestination(key: string) {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  const { itemId, locationId } = await f.addStockedItem(key, {
    quantity: 4,
    unitCost: 10
  });
  const job = await f.addConsumeToProjectJob(key, {
    locationId,
    materialItemId: itemId,
    quantityPerParent: 2,
    jobQuantity: 1,
    consumeToProject: false
  });
  const pickingListId = `${f.prefix}-${key}-pl`;
  const pickingListLineId = `${f.prefix}-${key}-pll`;
  await f.db.transaction().execute(async (trx) => {
    await trx
      .insertInto("pickingList")
      .values({
        id: pickingListId,
        pickingListId: `${f.prefix}-PL-${key}`,
        status: "In Progress",
        locationId,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("pickingListLine")
      .values({
        id: pickingListLineId,
        pickingListId,
        jobId: job.jobId,
        jobMaterialId: job.materialId,
        jobOperationId: job.operationId,
        itemId,
        quantityToPick: 2,
        toStorageUnitId: null,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
  });
  return { f, job, locationId, pickingListId, pickingListLineId };
}

databaseTest("a pick takes the destination from the operation's work center", async () => {
  const { f, job, locationId, pickingListId, pickingListLineId } =
    await lineWithoutDestination("resolve");
  try {
    expect(
      (
        await postPicking(f.ctx, {
          type: "inventory",
          pickingListId,
          pickingListLineId,
          quantity: 2,
          locationId
        })
      ).error
    ).toBeNull();

    const lineside = await f.db
      .selectFrom("storageUnit")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("workCenterId", "=", job.workCenterId)
      .executeTakeFirstOrThrow();
    const line = await f.db
      .selectFrom("pickingListLine")
      .select(["toStorageUnitId", "quantityPicked"])
      .where("id", "=", pickingListLineId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(line.toStorageUnitId).toBe(lineside.id);
    expect(Number(line.quantityPicked)).toBe(2);

    const placed = await f.db
      .selectFrom("itemLedger")
      .select("quantity")
      .where("companyId", "=", f.companyId)
      .where("documentLineId", "=", pickingListLineId)
      .where("storageUnitId", "=", lineside.id)
      .execute();
    expect(placed.map((row) => Number(row.quantity))).toEqual([2]);
  } finally {
    await f.cleanup();
  }
});

databaseTest("a pick is refused when the operation has no work center", async () => {
  const { f, job, locationId, pickingListId, pickingListLineId } =
    await lineWithoutDestination("refuse");
  try {
    await f.db
      .updateTable("jobOperation")
      .set({ workCenterId: null })
      .where("id", "=", job.operationId)
      .where("companyId", "=", f.companyId)
      .execute();

    const result = await postPicking(f.ctx, {
      type: "inventory",
      pickingListId,
      pickingListLineId,
      quantity: 2,
      locationId
    });
    expect(result.error?.message).toContain(
      "No lineside destination is set for this line"
    );

    const rows = await f.db
      .selectFrom("itemLedger")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("documentLineId", "=", pickingListLineId)
      .execute();
    expect(rows).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
