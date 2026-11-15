// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project stock (Projects Phase 2a): a pick moves the stripe its line draws,
// and consumption out of the picked stock books that stripe.

import { getPickedBudgets } from "@carbon/database/picked-consumption";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  issueMaterial,
  postPicking as postPickingBody,
  postStockTransfer as postStockTransferBody
} from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const issue = (ctx: Ctx, input: Parameters<typeof issueMaterial>[1]) =>
  invokePosting(handlesOf(ctx), "issue", input, issueMaterial);

const postStockTransfer = (
  ctx: Ctx,
  input: Parameters<typeof postStockTransferBody>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "post-stock-transfer",
    input,
    postStockTransferBody
  );

const postPicking = (ctx: Ctx, input: Parameters<typeof postPickingBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-picking", input, postPickingBody);

databaseTest("a partial pick rechecks stock and unpicks to each source bin", async () => {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  try {
    await f.enableProjectStock();
    const { itemId, locationId } = await f.addStockedItem("moving-pick", {
      quantity: 1,
      unitCost: 10
    });
    const firstBinId = `${f.prefix}-first-bin`;
    const secondBinId = `${f.prefix}-second-bin`;
    const linesideId = `${f.prefix}-pick-lineside`;
    const pickingListId = `${f.prefix}-moving-pl`;
    const pickingListLineId = `${f.prefix}-moving-pll`;
    const job = await f.addConsumeToProjectJob("moving-pick", {
      locationId,
      materialItemId: itemId,
      quantityPerParent: 6,
      jobQuantity: 1,
      consumeToProject: false
    });
    await f.db
      .updateTable("job")
      .set({ projectId: f.projectId, projectElementId: f.elementId })
      .where("id", "=", job.jobId)
      .execute();
    await f.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: firstBinId,
            name: "First shelf",
            locationId,
            companyId: f.companyId,
            createdBy: "system"
          },
          {
            id: secondBinId,
            name: "Second shelf",
            locationId,
            companyId: f.companyId,
            createdBy: "system"
          },
          {
            id: linesideId,
            name: "Lineside",
            locationId,
            workCenterId: job.workCenterId,
            companyId: f.companyId,
            createdBy: "system"
          }
        ])
        .execute();
      await trx
        .insertInto("pickingList")
        .values({
          id: pickingListId,
          pickingListId: `${f.prefix}-PL-2`,
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
          quantityToPick: 6,
          storageUnitId: firstBinId,
          toStorageUnitId: linesideId,
          projectId: f.projectId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
    });
    await f.addStripeStock({
      itemId,
      locationId,
      projectId: f.projectId,
      quantity: 2,
      unitCost: 10,
      storageUnitId: firstBinId
    });
    await f.addStripeStock({
      itemId,
      locationId,
      projectId: f.projectId,
      quantity: 4,
      unitCost: 10,
      storageUnitId: secondBinId
    });

    for (const quantity of [2, 4]) {
      expect(
        (await postPicking(f.ctx, {
          type: "inventory",
          pickingListId,
          pickingListLineId,
          quantity,
          locationId
        })).error
      ).toBeNull();
    }
    const pickedSources = await f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "quantity"])
      .where("companyId", "=", f.companyId)
      .where("documentLineId", "=", pickingListLineId)
      .where("quantity", "<", 0)
      .orderBy("quantity")
      .execute();
    expect(
      pickedSources.map((row) => [row.storageUnitId, Number(row.quantity)])
    ).toEqual([
      [secondBinId, -4],
      [firstBinId, -2]
    ]);

    for (const quantity of [3, 3]) {
      expect(
        (await postPicking(f.ctx, {
          type: "unpickInventory",
          pickingListId,
          pickingListLineId,
          quantity,
          locationId
        })).error
      ).toBeNull();
    }
    const netTransfers = await f.db
      .selectFrom("itemLedger")
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("quantity")
      ])
      .where("companyId", "=", f.companyId)
      .where("documentLineId", "=", pickingListLineId)
      .groupBy("storageUnitId")
      .execute();
    expect(
      netTransfers.map((row) => [row.storageUnitId, Number(row.quantity)])
    ).toEqual(
      expect.arrayContaining([
        [firstBinId, 0],
        [secondBinId, 0],
        [linesideId, 0]
      ])
    );

    // The saved first bin has two units, but the next four-unit pick must
    // draw entirely from the second bin that can cover it.
    expect(
      (await postPicking(f.ctx, {
        type: "inventory",
        pickingListId,
        pickingListLineId,
        quantity: 4,
        locationId
      })).error
    ).toBeNull();
    const afterShortSavedBin = await f.db
      .selectFrom("itemLedger")
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("quantity")
      ])
      .where("companyId", "=", f.companyId)
      .where("documentLineId", "=", pickingListLineId)
      .groupBy("storageUnitId")
      .execute();
    expect(
      afterShortSavedBin.map((row) => [
        row.storageUnitId,
        Number(row.quantity)
      ])
    ).toEqual(
      expect.arrayContaining([
        [firstBinId, 0],
        [secondBinId, -4],
        [linesideId, 4]
      ])
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a pick of project stock moves the project's stripe, and the backflush consumes it",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      // 10 in common stock at 10.00, 4 in the project's stock at 12.00.
      const { itemId, locationId } = await f.addStockedItem("pick", {
        quantity: 10,
        unitCost: 10
      });
      const sourceBinId = `${f.prefix}-new-source`;
      const oldDefaultBinId = `${f.prefix}-old-default`;
      await f.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values([
            {
              id: sourceBinId,
              name: "New shelf",
              locationId,
              companyId: f.companyId,
              createdBy: "system"
            },
            {
              id: oldDefaultBinId,
              name: "Default location",
              locationId,
              companyId: f.companyId,
              createdBy: "system"
            }
          ])
          .execute();
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12,
        storageUnitId: sourceBinId
      });
      const job = await f.addConsumeToProjectJob("pick", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 4,
        jobQuantity: 1,
        consumeToProject: false
      });
      await f.db
        .updateTable("job")
        .set({ projectId: f.projectId, projectElementId: f.elementId })
        .where("id", "=", job.jobId)
        .execute();

      // A negative common balance in the same bin cannot hide the project's
      // positive stock. The issue picker reads each eligible stripe first.
      await f.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values({
            postingDate: "2026-01-01",
            entryType: "Negative Adjmt.",
            itemId,
            locationId,
            storageUnitId: sourceBinId,
            quantity: -5,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const issueBins = async () =>
        (
          await sql<{
            storageUnitId: string | null;
            quantity: string;
          }>`SELECT "storageUnitId", quantity FROM get_job_issue_bins(${f.companyId}, ${job.jobId}, ARRAY[${itemId}]::TEXT[])`.execute(
            f.db
          )
        ).rows.map((row) => [row.storageUnitId, Number(row.quantity)]);
      expect(await issueBins()).toContainEqual([sourceBinId, 4]);

      const linesideId = `${f.prefix}-lineside`;
      const pickingListId = `${f.prefix}-pl`;
      const pickingListLineId = `${f.prefix}-pll`;
      await f.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values({
            id: linesideId,
            name: "Lineside",
            locationId,
            workCenterId: job.workCenterId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("pickingList")
          .values({
            id: pickingListId,
            pickingListId: `${f.prefix}-PL-1`,
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
            quantityToPick: 4,
            storageUnitId: oldDefaultBinId,
            toStorageUnitId: linesideId,
            projectId: f.projectId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const picked = await postPicking(f.ctx, {
        type: "inventory",
        pickingListId,
        pickingListLineId,
        quantity: 4,
        locationId
      });
      expect(picked.error).toBeNull();
      expect(await issueBins()).toContainEqual([linesideId, 4]);

      // Both legs of the Transfer pair carry the project.
      const transfer = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "storageUnitId", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Direct Transfer")
        .where("documentId", "=", pickingListId)
        .orderBy("quantity")
        .execute();
      expect(
        transfer.map((row) => [
          Number(row.quantity),
          row.storageUnitId,
          row.projectId
        ])
      ).toEqual([
        [-4, sourceBinId, f.projectId],
        [4, linesideId, f.projectId]
      ]);

      const pickedLine = await f.db
        .selectFrom("pickingListLine")
        .select("storageUnitId")
        .where("id", "=", pickingListLineId)
        .executeTakeFirstOrThrow();
      expect(pickedLine.storageUnitId).toBe(sourceBinId);

      const firstUnpick = await postPicking(f.ctx, {
        type: "unpickInventory",
        pickingListId,
        pickingListLineId,
        quantity: 4,
        locationId
      });
      const repeatedUnpick = await postPicking(f.ctx, {
        type: "unpickInventory",
        pickingListId,
        pickingListLineId,
        quantity: 4,
        locationId
      });
      expect(firstUnpick.error).toBeNull();
      expect(repeatedUnpick.error).toBeNull();
      const ledgerAfterUnpick = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Direct Transfer")
        .where("documentId", "=", pickingListId)
        .execute();
      expect(ledgerAfterUnpick).toHaveLength(4);
      expect(
        (
          await postPicking(f.ctx, {
            type: "inventory",
            pickingListId,
            pickingListLineId,
            quantity: 4,
            locationId
          })
        ).error
      ).toBeNull();

      // The material's budget is the picked stripe.
      const material = await f.db
        .selectFrom("jobMaterial")
        .selectAll()
        .where("id", "=", job.materialId)
        .executeTakeFirstOrThrow();
      const budgets = await getPickedBudgets(f.db, {
        material,
        locationId,
        companyId: f.companyId,
        opStorageUnitId: linesideId,
        stripes: [f.projectId, null]
      });
      expect(budgets.map((budget) => [budget.projectId, budget.own])).toEqual([
        [f.projectId, 4]
      ]);

      const backflush = await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1
      });
      expect(backflush.error).toBeNull();
      expect((await issueBins()).filter(([bin]) => bin === linesideId)).toEqual(
        []
      );

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "storageUnitId", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Consumption")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(
        consumed.map((row) => [
          Number(row.quantity),
          row.storageUnitId,
          row.projectId
        ])
      ).toEqual([[-4, linesideId, f.projectId]]);

      // The project's layer (4 x 12.00) is relieved, not the common one.
      const relief = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Consumption")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(relief.map((row) => [Number(row.cost), row.projectId])).toEqual([
        [-48, f.projectId]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a stock transfer of a lot in project stock keeps the lot's stripe",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { locationId } = await f.addStockedItem("st", {
        quantity: 1,
        unitCost: 1
      });
      const lotItemId = `${f.prefix}-item-st-lot`;
      const lotId = `${f.prefix}-st-lot`;
      const fromId = `${f.prefix}-shelf-a`;
      const toId = `${f.prefix}-shelf-b`;
      const stockTransferId = `${f.prefix}-st`;
      const stockTransferLineId = `${f.prefix}-stl`;
      await f.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: lotItemId,
            readableId: `${f.prefix}-ST-LOT`,
            name: "Resin",
            type: "Material",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("storageUnit")
          .values([
            {
              id: fromId,
              name: "Shelf A",
              locationId,
              companyId: f.companyId,
              createdBy: "system"
            },
            {
              id: toId,
              name: "Shelf B",
              locationId,
              companyId: f.companyId,
              createdBy: "system"
            }
          ])
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: lotId,
            readableId: "LOT-ST",
            itemId: lotItemId,
            quantity: 5,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: lotItemId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("stockTransfer")
          .values({
            id: stockTransferId,
            stockTransferId: `${f.prefix}-ST-1`,
            locationId,
            status: "Released",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("stockTransferLine")
          .values({
            id: stockTransferLineId,
            stockTransferId,
            itemId: lotItemId,
            quantity: 2,
            fromStorageUnitId: fromId,
            toStorageUnitId: toId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });
      await f.addStripeStock({
        itemId: lotItemId,
        locationId,
        projectId: f.projectId,
        quantity: 5,
        unitCost: 3,
        storageUnitId: fromId
      });
      await f.db
        .updateTable("itemLedger")
        .set({ trackedEntityId: lotId })
        .where("itemId", "=", lotItemId)
        .where("companyId", "=", f.companyId)
        .execute();

      // A partial move splits the lot: every row stays in the project.
      const moved = await postStockTransfer(f.ctx, {
        type: "batch",
        stockTransferId,
        stockTransferLineId,
        trackedEntityId: lotId,
        quantity: 2,
        locationId
      });
      expect(moved.error).toBeNull();

      const rows = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "storageUnitId", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", lotItemId)
        .where("entryType", "<>", "Positive Adjmt.")
        .execute();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((row) => row.projectId === f.projectId)).toBe(true);

      const onHand = await f.db
        .selectFrom("itemLedger")
        .select([
          "storageUnitId",
          "projectId",
          (eb) => eb.fn.sum<number>("quantity").as("quantity")
        ])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", lotItemId)
        .groupBy(["storageUnitId", "projectId"])
        .orderBy("storageUnitId")
        .execute();
      expect(
        onHand.map((row) => [
          row.storageUnitId,
          row.projectId,
          Number(row.quantity)
        ])
      ).toEqual([
        [fromId, f.projectId, 3],
        [toId, f.projectId, 2]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
