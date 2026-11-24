// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import {
  batchOperation,
  triggerCorrection,
  triggerRework
} from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { handlesOf, systemServiceOf } from "./fixtures/handles";
import { holdUnits, raiseIssue, serialJob } from "./fixtures/job-unit-hold";
import { databaseTest } from "./fixtures/local-database";

async function attachBatch(f: Fixture, operationId: string, batchId: string) {
  await seed(f, async (trx) => {
    const op = await trx
      .selectFrom("jobOperation")
      .select("processId")
      .where("id", "=", operationId)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("jobOperationBatch")
      .values({
        id: batchId,
        processId: op.processId!,
        locationId: f.locationId,
        readableId: "BATCH-1",
        status: "Active",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ jobOperationBatchId: batchId })
      .where("id", "=", operationId)
      .execute();
  });
}

databaseTest(
  "both batch output postings leave a rejected serial and its production intact",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 2);
      const unitId = `${f.prefix}-unit-1`;
      await holdUnits(f, true);
      const issueId = await raiseIssue(f, 1);
      await seed(f, async (trx) => {
        const row = await trx
          .insertInto("nonConformanceItem")
          .values({
            nonConformanceId: issueId,
            itemId: f.assemblyId,
            disposition: "Scrap",
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("nonConformanceItemTrackedEntity")
          .values({
            nonConformanceId: issueId,
            nonConformanceItemId: row.id,
            trackedEntityId: unitId,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", issueId)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Rejected" })
          .where("id", "=", unitId)
          .execute();
        // A good sibling's completed quantity makes the second posting resumable.
        await trx
          .insertInto("productionQuantity")
          .values({
            jobOperationId: job.operationId,
            quantity: 1,
            type: "Production",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      for (const type of [
        "jobOperationBatchComplete",
        "jobOperationBatchOutput"
      ] as const) {
        const attempt = await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type,
            quantity: 1,
            jobOperationId: job.operationId,
            trackedEntityId: unitId
          },
          issueMaterial
        );
        expect(attempt.error?.message).toContain("NCR-1 (Scrap)");
      }
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("quantity")
          .where("jobOperationId", "=", job.operationId)
          .execute()
      ).toEqual([{ quantity: 1 }]);
      expect(
        await f.db
          .selectFrom("trackedActivityOutput")
          .select("trackedActivityId")
          .where("trackedEntityId", "=", unitId)
          .execute()
      ).toEqual([]);
      expect(
        await f.db
          .selectFrom("trackedEntity")
          .select(["quantity", "status", "readableId"])
          .where("id", "=", unitId)
          .executeTakeFirst()
      ).toEqual({ quantity: 1, status: "Rejected", readableId: "SN-001" });
      // A lot on a batch-tracked method may still complete with an open NCR.
      await seed(f, async (trx) => {
        await trx
          .updateTable("nonConformance")
          .set({ status: "Registered" })
          .where("id", "=", issueId)
          .execute();
        await trx
          .updateTable("jobMakeMethod")
          .set({ requiresSerialTracking: false, requiresBatchTracking: true })
          .where("id", "=", job.makeMethodId)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Reserved" })
          .where("id", "=", unitId)
          .execute();
      });
      const lot = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationBatchOutput",
          quantity: 1,
          jobOperationId: job.operationId,
          trackedEntityId: unitId
        },
        issueMaterial
      );
      expect(lot.error).toBeNull();
      expect(
        await f.db
          .selectFrom("trackedEntity")
          .select("status")
          .where("id", "=", unitId)
          .executeTakeFirst()
      ).toEqual({ status: "Available" });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "material issue refuses a held serial and a batch pick charges its eligible sibling",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 2);
      await holdUnits(f, true);
      await raiseIssue(f, 1);
      const heldId = `${f.prefix}-unit-1`;
      const eligibleId = `${f.prefix}-unit-2`;
      const componentId = `${f.prefix}-component`;
      const batchId = `${f.prefix}-batch`;
      await seed(f, async (trx) => {
        await trx
          .updateTable("jobMaterial")
          .set({ requiresBatchTracking: true })
          .where("id", "=", job.materialId)
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: componentId,
            itemId: f.partId,
            readableId: "KIT-1",
            quantity: 1,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: f.partId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            itemId: f.partId,
            trackedEntityId: componentId,
            quantity: 1,
            locationId: f.locationId,
            entryType: "Positive Adjmt.",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await attachBatch(f, job.operationId, batchId);
      const children = [{ trackedEntityId: componentId, quantity: 1 }];
      const direct = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "trackedEntitiesToOperation",
          materialId: job.materialId,
          parentTrackedEntityId: heldId,
          children
        },
        issueMaterial
      );
      expect(direct.error?.message).toContain("NCR-1");
      const ledger = () =>
        f.db
          .selectFrom("itemLedger")
          .select("quantity")
          .where("trackedEntityId", "=", componentId)
          .where("documentType", "=", "Job Consumption")
          .execute();
      expect(await ledger()).toEqual([]);
      const pick = () =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "trackedEntitiesToBatch",
            batchId,
            itemId: f.partId,
            children
          },
          issueMaterial
        );
      const secondIssue = await raiseIssue(f, 2);
      expect((await pick()).error?.message).toContain(
        "No eligible output unit"
      );
      expect(await ledger()).toEqual([]);
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", secondIssue)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const batch = await pick();
      expect(batch.error).toBeNull();
      expect(await ledger()).toEqual([{ quantity: -1 }]);
      const outputs = await f.db
        .selectFrom("trackedActivityOutput as output")
        .innerJoin(
          "trackedActivity as activity",
          "activity.id",
          "output.trackedActivityId"
        )
        .select("output.trackedEntityId")
        .where("activity.type", "=", "Consume")
        .where("activity.sourceDocumentId", "=", job.materialId)
        .execute();
      expect(outputs).toEqual([{ trackedEntityId: eligibleId }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "rework and correction cannot give the fourth serial production credit while it is on hold",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 4);
      await holdUnits(f, true);
      await raiseIssue(f, 4);
      const unitId = `${f.prefix}-unit-4`;
      const correctionId = `${f.prefix}-corr`;
      await seed(f, async (trx) => {
        await trx
          .updateTable("jobOperation")
          .set({
            targetQuantity: 4,
            operationQuantity: 4,
            status: "In Progress"
          })
          .where("id", "=", job.operationId)
          .execute();
        await trx
          .insertInto("productionQuantity")
          .values({
            jobOperationId: job.operationId,
            type: "Production",
            quantity: 3,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("jobCorrection")
          .values({
            id: correctionId,
            jobId: job.jobId,
            jobMakeMethodId: job.makeMethodId,
            name: "Repair",
            returnTo: "Continue",
            definition: {
              version: 1,
              operations: [
                {
                  key: "repair",
                  operation: { description: "Repair" },
                  steps: [],
                  tools: [],
                  parameters: []
                }
              ],
              materials: []
            },
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const ctx = systemServiceOf(f.ctx, f.groupId);
      const dispatch = {
        jobId: job.jobId,
        triggeredAtJobOperationId: job.operationId,
        reason: "Repair",
        quantity: 1,
        trackedEntityIds: [unitId]
      };
      await expect(
        triggerRework(ctx, {
          ...dispatch,
          targetJobOperationId: job.operationId
        })
      ).rejects.toThrow("NCR-4");
      await expect(
        triggerCorrection(ctx, { ...dispatch, jobCorrectionId: correctionId })
      ).rejects.toThrow("NCR-4");
      await expect(
        triggerRework(ctx, {
          ...dispatch,
          trackedEntityIds: [],
          targetJobOperationId: job.operationId
        })
      ).rejects.toThrow("Select one serial unit");
      expect(
        await f.db
          .selectFrom("rework")
          .select("id")
          .where("jobId", "=", job.jobId)
          .execute()
      ).toEqual([]);
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select(["quantity", "type"])
          .where("jobOperationId", "=", job.operationId)
          .execute()
      ).toEqual([{ quantity: 3, type: "Production" }]);
      expect(
        await f.db
          .selectFrom("jobOperation")
          .select("status")
          .where("id", "=", job.operationId)
          .executeTakeFirst()
      ).toEqual({ status: "In Progress" });

      await holdUnits(f, false);
      const dispatched = await triggerRework(ctx, {
        ...dispatch,
        targetJobOperationId: job.operationId
      });
      expect(dispatched.success).toBe(true);
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("quantity")
          .where("jobOperationId", "=", job.operationId)
          .where("type", "=", "Rework")
          .execute()
      ).toEqual([{ quantity: 1 }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a batch naming an open-held output refuses before it credits the operation",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 2);
      await stockPart(f, 10);
      await holdUnits(f, true);
      await raiseIssue(f, 1);
      const batchId = `${f.prefix}-batch`;
      await attachBatch(f, job.operationId, batchId);
      const result = await invokePosting(
        handlesOf(f.ctx),
        "batch-operations",
        {
          type: "complete",
          batchId,
          members: [
            {
              jobOperationId: job.operationId,
              trackedEntityId: `${f.prefix}-unit-1`,
              quantity: 1
            }
          ]
        },
        batchOperation
      );
      expect(result.error?.message).toContain("NCR-1");
      expect(
        await f.db
          .selectFrom("jobOperationBatch")
          .select("status")
          .where("id", "=", batchId)
          .executeTakeFirst()
      ).toEqual({ status: "Active" });
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("id")
          .where("jobOperationId", "=", job.operationId)
          .execute()
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
