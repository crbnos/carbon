// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  fetchActivityStepRecords,
  issueMaterial
} from "../../app/modules/inventory/inventory.service";
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
import {
  holdUnits,
  raiseIssue,
  raiseIssueOnUnit,
  serialJob
} from "./fixtures/job-unit-hold";
import { postgrestTest } from "./fixtures/local-supabase";
import { stepRecordsForSelection } from "../../app/modules/inventory/ui/Traceability/stepRecords";
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
  "material issue and batch pick refuse a held serial part into an unheld unit until its issue closes",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 1);
      await holdUnits(f, true);
      const parentId = `${f.prefix}-unit-1`;
      const partUnitId = `${f.prefix}-part-unit`;
      const batchId = `${f.prefix}-batch`;
      await seed(f, async (trx) => {
        await trx
          .updateTable("item")
          .set({ itemTrackingType: "Serial" })
          .where("id", "=", f.partId)
          .execute();
        await trx
          .updateTable("jobMaterial")
          .set({ requiresSerialTracking: true })
          .where("id", "=", job.materialId)
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: partUnitId,
            itemId: f.partId,
            readableId: "SA-5",
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
            trackedEntityId: partUnitId,
            quantity: 1,
            locationId: f.locationId,
            entryType: "Positive Adjmt.",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const issueId = await raiseIssueOnUnit(f, partUnitId, 5);
      await attachBatch(f, job.operationId, batchId);
      const children = [{ trackedEntityId: partUnitId, quantity: 1 }];
      const issue = () =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "trackedEntitiesToOperation",
            materialId: job.materialId,
            parentTrackedEntityId: parentId,
            children
          },
          issueMaterial
        );
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
      const consumption = () =>
        f.db
          .selectFrom("itemLedger")
          .select("quantity")
          .where("trackedEntityId", "=", partUnitId)
          .where("documentType", "=", "Job Consumption")
          .execute();

      // The refusal names the part, not the unit it was going into.
      expect((await issue()).error?.message).toMatch(/SA-5.*NCR-5/);
      expect((await pick()).error?.message).toMatch(/SA-5.*NCR-5/);
      expect(await consumption()).toEqual([]);

      await seed(f, (trx) =>
        trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", issueId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      expect((await issue()).error).toBeNull();
      expect(await consumption()).toEqual([{ quantity: -1 }]);
      const part = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", partUnitId)
        .executeTakeFirstOrThrow();
      expect(part).toEqual({ status: "Consumed" });
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

async function activeSerialBatch(f: Fixture, quantity: number) {
  const job = await serialJob(f, quantity);
  await stockPart(f, 10);
  const batchId = `${f.prefix}-batch`;
  await attachBatch(f, job.operationId, batchId);
  await seed(f, async (trx) => {
    const op = await trx
      .updateTable("jobOperation")
      .set({
        quantityComplete: 0,
        quantityReworked: 0,
        quantityScrapped: 0,
        targetQuantity: quantity,
        operationQuantity: quantity,
        status: "In Progress"
      })
      .where("id", "=", job.operationId)
      .returning("processId")
      .executeTakeFirstOrThrow();
    const final = await trx
      .insertInto("jobOperation")
      .values({
        jobId: job.jobId,
        jobMakeMethodId: job.makeMethodId,
        processId: op.processId,
        description: "Final inspection",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("jobOperationDependency")
      .values({
        operationId: final.id,
        dependsOnId: job.operationId,
        jobId: job.jobId,
        companyId: f.companyId
      })
      .execute();
  });
  await holdUnits(f, true);
  const issueId = await raiseIssue(f, 1);
  await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
    f.db
  );
  // Exactly what batch.$batchId.complete sends for a serial member.
  const submit = (produced: number) =>
    invokePosting(
      handlesOf(f.ctx),
      "batch-operations",
      {
        type: "complete",
        batchId,
        members: [
          {
            jobOperationId: job.operationId,
            quantity: produced,
            scrapQuantity: 0,
            trackedEntityId: null,
            batchNumber: null,
            excluded: false
          }
        ]
      },
      batchOperation
    );
  return { ...job, batchId, issueId, submit };
}

databaseTest(
  "a process batch refuses its only held serial before any production or material issue",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await activeSerialBatch(f, 1);
      const op = f.db
        .selectFrom("jobOperation")
        .select([
          "status",
          "quantityComplete",
          "quantityScrapped",
          "jobOperationBatchId"
        ])
        .where("id", "=", job.operationId);
      const mat = f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.materialId);
      const before = await op.executeTakeFirstOrThrow();
      const issued = await mat.executeTakeFirstOrThrow();
      expect((await job.submit(1)).error?.message).toContain("NCR-1");
      expect(await op.executeTakeFirstOrThrow()).toEqual(before);
      expect(await mat.executeTakeFirstOrThrow()).toEqual(issued);
      expect(
        await f.db
          .selectFrom("jobOperationBatch")
          .select("status")
          .where("id", "=", job.batchId)
          .executeTakeFirst()
      ).toEqual({ status: "Active" });
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("id")
          .where("jobOperationId", "=", job.operationId)
          .execute()
      ).toEqual([]);
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select("id")
          .where("documentId", "=", job.jobId)
          .execute()
      ).toEqual([]);

      await holdUnits(f, false);
      expect((await job.submit(1)).error).toBeNull();
      expect(await op.executeTakeFirstOrThrow()).toMatchObject({
        status: "Done",
        quantityComplete: 1
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a mixed process batch credits its eligible serial and returns the operation to the floor for its held sibling",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await activeSerialBatch(f, 2);
      expect((await job.submit(2)).error?.message).toContain("NCR-1");
      // Material posting needs the company's posting accounts in phase two.
      // Release A between that failure and the operator's retry.
      const accounts = await f.db
        .deleteFrom("accountDefault")
        .where("companyId", "=", f.companyId)
        .returningAll()
        .executeTakeFirstOrThrow();
      expect((await job.submit(1)).error?.message).toMatch(/issue materials/i);
      const batch = f.db
        .selectFrom("jobOperationBatch")
        .select("status")
        .where("id", "=", job.batchId);
      expect(await batch.executeTakeFirst()).toEqual({ status: "Completing" });
      await seed(f, async (trx) => {
        await trx.insertInto("accountDefault").values(accounts).execute();
        await trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", job.issueId)
          .execute();
      });
      expect((await job.submit(2)).error?.message).toMatch(/already recorded/i);
      expect((await job.submit(1)).error).toBeNull();
      const op = f.db
        .selectFrom("jobOperation")
        .select(["status", "quantityComplete", "jobOperationBatchId"])
        .where("id", "=", job.operationId);
      expect(await op.executeTakeFirstOrThrow()).toEqual({
        status: "In Progress",
        quantityComplete: 1,
        jobOperationBatchId: null
      });
      const marked = () =>
        f.db
          .selectFrom("trackedEntity")
          .select("readableId")
          .where("companyId", "=", f.companyId)
          .where(sql<boolean>`attributes ? ${"Operation " + job.operationId}`)
          .orderBy("readableId")
          .execute();
      expect(await marked()).toEqual([{ readableId: "SN-002" }]);
      expect(await batch.executeTakeFirst()).toEqual({ status: "Completed" });
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select("quantity")
          .where("documentId", "=", job.jobId)
          .where("documentType", "=", "Job Consumption")
          .execute()
      ).toEqual([{ quantity: -2 }]);
      const finish = () =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationSerialComplete",
            trackedEntityId: `${f.prefix}-unit-1`,
            quantity: 1,
            jobOperationId: job.operationId
          },
          issueMaterial
        );
      expect((await finish()).error).toBeNull();
      expect((await finish()).error?.message).toMatch(/already complete/i);
      expect(await marked()).toEqual([
        { readableId: "SN-001" },
        { readableId: "SN-002" }
      ]);
      expect(await op.executeTakeFirstOrThrow()).toMatchObject({
        status: "Done",
        quantityComplete: 2
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an active process batch cannot credit a job that ERP completed or reuse its received serial after reopen",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await activeSerialBatch(f, 2);
      await sql`SELECT complete_job_to_inventory(
        p_job_id := ${job.jobId}, p_quantity_complete := 1,
        p_company_id := ${f.companyId}, p_user_id := ${USER}
      )`.execute(f.db);
      const ledger = f.db
        .selectFrom("itemLedger")
        .select(["documentType", "trackedEntityId", "quantity"])
        .where("documentId", "=", job.jobId)
        .orderBy("documentType");
      const afterReceipt = await ledger.execute();
      expect(
        afterReceipt.filter((row) => row.documentType === "Job Receipt")
      ).toEqual([
        {
          documentType: "Job Receipt",
          trackedEntityId: `${f.prefix}-unit-2`,
          quantity: 1
        }
      ]);
      expect((await job.submit(1)).error?.message).toMatch(/is Completed/);
      await seed(f, (trx) =>
        trx
          .updateTable("job")
          .set({ status: "In Progress" })
          .where("id", "=", job.jobId)
          .execute()
      );
      expect((await job.submit(1)).error?.message).toMatch(/NCR-1/);
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("id")
          .where("jobOperationId", "=", job.operationId)
          .execute()
      ).toEqual([]);
      expect(await ledger.execute()).toEqual(afterReceipt);
      expect(
        await f.db
          .selectFrom("jobOperationBatch")
          .select("status")
          .where("id", "=", job.batchId)
          .executeTakeFirst()
      ).toEqual({ status: "Active" });
    } finally {
      await f.cleanup();
    }
  }
);

type HistoricalBatchOutput = "Produce" | "Complete" | "multi-unit" | "unnamed";
async function seedHistoricalBatchOutput(
  f: Fixture,
  operationId: string,
  shape: HistoricalBatchOutput
) {
  await seed(f, async (trx) => {
    if (shape !== "unnamed") {
      const activity = await trx
        .insertInto("trackedActivity")
        .values({
          type: shape === "Complete" ? "Complete" : "Produce",
          sourceDocument: "Job Operation",
          sourceDocumentId: operationId,
          attributes: { "Job Operation": operationId, Employee: USER },
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("trackedActivityOutput")
        .values({
          trackedActivityId: activity.id,
          trackedEntityId: `${f.prefix}-unit-2`,
          quantity: shape === "multi-unit" ? 2 : 1,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }
    await trx
      .insertInto("productionQuantity")
      .values({
        jobOperationId: operationId,
        type: "Production",
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ quantityComplete: 1 })
      .where("id", "=", operationId)
      .execute();
  });
}

function batchGenealogy(f: Fixture, operationId: string) {
  return f.db
    .selectFrom("trackedActivity as a")
    .innerJoin("trackedActivityOutput as o", "o.trackedActivityId", "a.id")
    .select([
      "o.trackedEntityId",
      "o.quantity",
      "a.type",
      sql<string>`a.attributes->>'Job Operation'`.as("operation")
    ])
    .where("a.sourceDocument", "=", "Job Operation")
    .where("a.sourceDocumentId", "=", operationId)
    .where("a.companyId", "=", f.companyId)
    .where("a.type", "in", ["Produce", "Complete"])
    .orderBy("o.trackedEntityId")
    .execute();
}

for (const shape of ["Produce", "multi-unit", "unnamed"] as const) {
  databaseTest(
    `an open-held batch leaves historical ${shape} production and materials intact when no unit can be credited`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const job = await activeSerialBatch(f, shape === "Produce" ? 2 : 3);
        await seedHistoricalBatchOutput(f, job.operationId, shape);
        const before = await batchGenealogy(f, job.operationId);
        expect(
          (await job.submit(shape === "Produce" ? 1 : 2)).error?.message
        ).toMatch(shape === "Produce" ? /NCR-1/ : /earlier production/i);
        expect(await batchGenealogy(f, job.operationId)).toEqual(before);
        expect(
          await f.db
            .selectFrom("productionQuantity")
            .select(["type", "quantity"])
            .where("jobOperationId", "=", job.operationId)
            .execute()
        ).toEqual([{ type: "Production", quantity: 1 }]);
        expect(
          await f.db
            .selectFrom("jobMaterial")
            .select("quantityIssued")
            .where("id", "=", job.materialId)
            .executeTakeFirst()
        ).toEqual({ quantityIssued: 0 });
        expect(
          await f.db
            .selectFrom("jobOperationBatch")
            .select("status")
            .where("id", "=", job.batchId)
            .executeTakeFirst()
        ).toEqual({ status: "Active" });
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "an ordinary batch credits only the remaining eligible sibling after a historical serial completion, including on resume",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await activeSerialBatch(f, 3);
      await seedHistoricalBatchOutput(f, job.operationId, "Complete");
      const accounts = await f.db
        .deleteFrom("accountDefault")
        .where("companyId", "=", f.companyId)
        .returningAll()
        .executeTakeFirstOrThrow();
      expect((await job.submit(1)).error?.message).toMatch(/issue materials/i);
      await seed(f, (trx) =>
        trx.insertInto("accountDefault").values(accounts).execute()
      );
      expect((await job.submit(2)).error?.message).toMatch(/already recorded/i);
      expect((await job.submit(1)).error).toBeNull();
      // Back on the individual serial screen, the pre-marker serial still
      // cannot be completed again by name.
      const duplicate = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationSerialComplete",
          quantity: 1,
          jobOperationId: job.operationId,
          trackedEntityId: `${f.prefix}-unit-2`
        },
        issueMaterial
      );
      expect(duplicate.error?.message).toMatch(/already complete/i);
      expect(await batchGenealogy(f, job.operationId)).toEqual([
        {
          trackedEntityId: `${f.prefix}-unit-2`,
          quantity: 1,
          type: "Complete",
          operation: job.operationId
        },
        {
          trackedEntityId: `${f.prefix}-unit-3`,
          quantity: 1,
          type: "Produce",
          operation: job.operationId
        }
      ]);
      expect(
        await f.db
          .selectFrom("jobOperation")
          .select(["quantityComplete", "status", "jobOperationBatchId"])
          .where("id", "=", job.operationId)
          .executeTakeFirst()
      ).toEqual({
        quantityComplete: 2,
        status: "In Progress",
        jobOperationBatchId: null
      });
    } finally {
      await f.cleanup();
    }
  }
);

for (const quantity of [2, 3]) {
  postgrestTest(
    `the traceability sidebar attributes measurements only to the ${quantity - 1} serials produced in a mixed batch`,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        const scoped = quantity === 3;
        const job = await activeSerialBatch(f, scoped ? 4 : 2);
        await seed(f, async (trx) => {
          if (scoped) {
            // The third unit has measurements but is outside this operation's
            // rework scope. Its place in the step index still belongs to it.
            await trx
              .insertInto("jobOperationTrackedEntity")
              .values(
                [1, 2, 4].map((n) => ({
                  companyId: f.companyId,
                  createdBy: USER,
                  jobOperationId: job.operationId,
                  trackedEntityId: `${f.prefix}-unit-${n}`
                }))
              )
              .execute();
          }
          const step = await trx
            .insertInto("jobOperationStep")
            .values({
              operationId: job.operationId,
              type: "Measurement",
              name: "Thickness",
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("jobOperationStepRecord")
            .values(
              (scoped ? [15, 10, 99, 11] : [15, 10]).map(
                (numericValue, index) => ({
                  numericValue,
                  index,
                  jobOperationStepId: step.id,
                  companyId: f.companyId,
                  createdBy: USER
                })
              )
            )
            .execute();
        });
        expect((await job.submit(quantity - 1)).error).toBeNull();
        const activity = await f.db
          .selectFrom("trackedActivity")
          .select(["id", "attributes"])
          .where("companyId", "=", f.companyId)
          .where("type", "=", "Produce")
          .where("sourceDocumentId", "=", job.operationId)
          .executeTakeFirstOrThrow();
        // A serial may be renamed later. The historical activity's step
        // indices must not be re-ranked using the serials as they are now.
        await seed(f, (trx) =>
          trx
            .updateTable("trackedEntity")
            .set({ readableId: "SN-999" })
            .where("id", "=", `${f.prefix}-unit-1`)
            .execute()
        );
        const measurements = {
          activityId: activity.id,
          stepRecords: await fetchActivityStepRecords(
            client,
            activity.id,
            f.companyId
          )
        };
        expect(
          stepRecordsForSelection(activity.id, measurements).map((r) => [
            r.outputSerial,
            r.index,
            r.numericValue
          ])
        ).toEqual(
          [
            ["SN-002", 1, 10],
            ["SN-004", 3, 11]
          ].slice(0, quantity - 1)
        );
        expect(
          stepRecordsForSelection("another-activity", measurements)
        ).toEqual([]);

        // An older batch's ordinal markers on the entities give no durable
        // evidence of the step indices. The HTTP response must withhold them.
        await seed(f, (trx) =>
          trx
            .updateTable("trackedActivity")
            .set({ attributes: sql`attributes - 'Output Unit Indices'` })
            .where("id", "=", activity.id)
            .execute()
        );
        expect(
          await fetchActivityStepRecords(client, activity.id, f.companyId)
        ).toEqual([]);
      } finally {
        await f.cleanup();
      }
    }
  );
}
