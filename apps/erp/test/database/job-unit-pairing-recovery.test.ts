// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  issueMaterial,
  postInventoryAdjustment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  USER,
  unwrap
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";
import { handlesOf } from "./fixtures/handles";
import { receiveProductionPair } from "./fixtures/packout-production";
import { createPairedJob, confirmPackoutCommand } from "./fixtures/paired-job";

async function packout(f: Fixture, quantity = 2) {
  const production = await receiveProductionPair(f);
  const job = await createPairedJob(f, production.productionItemId, quantity);
  const post = async (input: Parameters<typeof issueMaterial>[1]) =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "issue",
        await confirmPackoutCommand(f, input),
        issueMaterial
      )
    );
  const assign = (
    source: string,
    outputId = job.unitId,
    materialId = job.materialId
  ) =>
    post({
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId: job.operationId,
      parentTrackedEntityId: outputId,
      children: [{ trackedEntityId: source, quantity: 1 }]
    });
  const recover = (trackedEntityId: string, itemId: string) =>
    invokePosting(
      handlesOf(f.ctx),
      "post-inventory-adjustment",
      {
        adjustmentType: "Unscrap",
        itemId,
        trackedEntityId,
        locationId: f.locationId,
        quantity: 1
      },
      postInventoryAdjustment
    );
  const reason = await f.db
    .insertInto("scrapReason")
    .values({
      name: "Damaged",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { production, job, post, assign, recover, reason };
}

for (const scrapRoute of ["scrapTrackedEntity", "scrapJobPart"] as const) {
  databaseTest(
    `a fitted source recovered after ${scrapRoute} restores its booked cost and leaves room for a replacement`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const { production, job, post, assign, recover, reason } =
          await packout(f);
        const source = production.first.id!;
        await f.db
          .updateTable("trackedEntity")
          .set({ sourceDocument: "Job", sourceDocumentId: production.jobId })
          .where("companyId", "=", f.companyId)
          .where("id", "=", source)
          .execute();
        await assign(source);
        await f.db
          .updateTable("itemCost")
          .set({ unitCost: 87 })
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", production.productionItemId)
          .execute();
        if (scrapRoute === "scrapTrackedEntity") {
          await post({
            type: scrapRoute,
            trackedEntityId: source,
            materialId: job.materialId,
            parentTrackedEntityId: job.unitId,
            scrapReasonId: reason.id
          });
        } else {
          await post({
            type: scrapRoute,
            scrapReasonId: reason.id,
            jobOperationId: job.operationId,
            idempotencyKey: randomUUID(),
            replacement: "Shelf",
            lines: [
              {
                materialId: job.materialId,
                trackedEntityId: source,
                quantity: 1
              }
            ]
          });
        }
        expect(
          await f.db
            .selectFrom("journalLine")
            .select(["amount"])
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", job.jobId)
            .where("documentType", "=", "Scrap")
            .where("accountId", "=", f.account("wip"))
            .execute()
        ).toEqual([{ amount: -20 }]);
        unwrap(await recover(source, production.productionItemId));
        const restored = await f.db
          .selectFrom("costLedger")
          .select(["cost", "quantity", "remainingQuantity", "trackedEntityId"])
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Scrap")
          .where("quantity", ">", 0)
          .where("itemId", "=", production.productionItemId)
          .execute();
        expect(restored).toEqual([
          {
            cost: 20,
            quantity: 1,
            remainingQuantity: 1,
            trackedEntityId: source
          }
        ]);
        await assign(production.second.id!);
        expect(
          await f.db
            .selectFrom("jobUnitPairing")
            .select(["sourceId"])
            .where("companyId", "=", f.companyId)
            .where("jobId", "=", job.jobId)
            .where("releasedAt", "is", null)
            .execute()
        ).toEqual([{ sourceId: production.second.id }]);
        expect(
          (
            await f.db
              .selectFrom("jobMaterial")
              .select("quantityIssued")
              .where("companyId", "=", f.companyId)
              .where("id", "=", job.materialId)
              .executeTakeFirstOrThrow()
          ).quantityIssued
        ).toBe(1);
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "a stale Scrap confirmation leaves a replacement component and its output intact",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { production, job, post, assign, reason } = await packout(f);
      await assign(production.first.id!);
      const scrap = await confirmPackoutCommand(f, {
        type: "jobOperationScrap", jobOperationId: job.operationId,
        trackedEntityId: job.unitId, quantity: 1, scrapReasonId: reason.id
      });
      await post({
        type: "unconsumeTrackedEntities", materialId: job.materialId,
        parentTrackedEntityId: job.unitId,
        children: [{ trackedEntityId: production.first.id!, quantity: 1 }]
      });
      const submit = () => invokePosting(handlesOf(f.ctx), "issue", scrap, issueMaterial);
      expect((await submit()).error?.message).toContain("packing relationship has changed");
      await assign(production.second.id!);
      expect((await submit()).error?.message).toContain("packing relationship has changed");
      expect(await f.db.selectFrom("jobUnitPairing").select("sourceId")
        .where("companyId", "=", f.companyId).where("outputId", "=", job.unitId)
        .where("releasedAt", "is", null).execute()).toEqual([{ sourceId: production.second.id }]);
      expect(await f.db.selectFrom("productionQuantity").select("id")
        .where("companyId", "=", f.companyId).where("jobOperationId", "=", job.operationId)
        .where("type", "=", "Scrap").execute()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the ERP stock Unscrap cannot receive an output scrapped on its pack-out job",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { production, job, post, assign, recover, reason } =
        await packout(f);
      await assign(production.first.id!);
      await post({
        type: "jobOperationScrap",
        jobOperationId: job.operationId,
        trackedEntityId: job.unitId,
        quantity: 1,
        scrapReasonId: reason.id
      });
      expect(
        (await recover(job.unitId, job.salesItemId)).error?.message
      ).toContain("before receipt");
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("trackedEntityId", "=", job.unitId)
          .execute()
      ).toEqual([]);
      expect(
        (
          await f.db
            .selectFrom("trackedEntity")
            .select("status")
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .executeTakeFirstOrThrow()
        ).status
      ).toBe("Scrapped");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "issuing a tracked carton before scanning serials fits the carton to one sales unit",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { production, job, post, assign } = await packout(f);
      const method = await f.db
        .selectFrom("jobMaterial")
        .select("jobMakeMethodId")
        .where("companyId", "=", f.companyId)
        .where("id", "=", job.materialId)
        .executeTakeFirstOrThrow();
      const carton = `${f.prefix}-carton`;
      await f.db
        .insertInto("item")
        .values({
          id: carton,
          readableId: "Carton",
          name: "Tracked carton",
          type: "Part",
          itemTrackingType: "Batch",
          replenishmentSystem: "Buy",
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 3 })
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", carton)
        .execute();
      const packaging = await f.db
        .insertInto("jobMaterial")
        .values({
          jobId: job.jobId,
          jobMakeMethodId: method.jobMakeMethodId,
          jobOperationId: job.operationId,
          itemId: carton,
          itemType: "Part",
          description: "Carton",
          methodType: "Pull from Inventory",
          quantity: 0.5,
          estimatedQuantity: 1,
          requiresBatchTracking: true,
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const lot = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: carton,
          sourceDocument: "Item",
          sourceDocumentId: carton,
          quantity: 1,
          readableId: "LOT-1",
          status: "Available",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("itemLedger")
        .values({
          entryType: "Positive Adjmt.",
          itemId: carton,
          trackedEntityId: lot.id,
          quantity: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await f.db
        .insertInto("costLedger")
        .values({
          costLedgerType: "Direct Cost",
          itemLedgerType: "Positive Adjmt.",
          itemId: carton,
          trackedEntityId: lot.id,
          quantity: 1,
          cost: 3,
          remainingQuantity: 1,
          companyId: f.companyId
        })
        .execute();
      await assign(lot.id!, job.unitId, packaging.id!);
      const outputs = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .execute();
      expect(outputs.map((o) => o.quantity)).toEqual([1, 1]);
      const other = outputs.find((o) => o.id !== job.unitId)!.id!;
      await assign(production.first.id!, job.unitId);
      await assign(production.second.id!, other);
      for (const unit of [job.unitId, other])
        await post({
          type: "jobOperationSerialComplete",
          jobOperationId: job.operationId,
          trackedEntityId: unit,
          quantity: 1
        });
      expect(
        await f.db
          .selectFrom("costLedger")
          .select(["quantity", "cost"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", job.jobId)
          .where("itemId", "=", carton)
          .execute()
      ).toEqual([{ quantity: -1, cost: -3 }]);
      expect(
        (
          await f.db
            .selectFrom("costLedger")
            .select(sql<number>`sum(cost)`.as("total"))
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", job.jobId)
            .where("documentType", "=", "Job Receipt")
            .executeTakeFirstOrThrow()
        ).total
      ).toBe(43);
    } finally {
      await f.cleanup();
    }
  }
);

for (const historical of [false, true]) {
  databaseTest(
    `${historical ? "Historical" : "New"} inspection scrap accounts for the sole output when Finish closes the packing job`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const { production, job, post, assign, reason } = await packout(f, 1);
        await assign(production.first.id!);
        const lot = await f.db
          .insertInto("inspection")
          .values({
            inspectionId: `${f.prefix}-inspection`,
            sourceDocument: "Job Operation",
            sourceDocumentId: job.jobId,
            sourceDocumentLineId: job.operationId,
            itemId: job.salesItemId,
            lotSize: 1,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 1,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            status: "Failed",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (historical) {
          await f.db
            .updateTable("trackedEntity")
            .set({ status: "Rejected" })
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .returning("id")
            .executeTakeFirstOrThrow();
          // Reject alone can be followed by rework or release.
          expect(
            (
              await sql<{
                n: number;
              }>`SELECT job_scrapped_paired_output_count(${job.jobId}, ${f.companyId}) AS n`.execute(
                f.db
              )
            ).rows[0]?.n
          ).toBe(0);
          await f.db
            .insertInto("productionQuantity")
            .values({
              type: "Scrap",
              companyId: f.companyId,
              createdBy: USER,
              inspectionId: lot.id,
              jobOperationId: job.operationId,
              scrapReasonId: reason.id,
              quantity: 1
            })
            .execute();
        } else {
          await post({
            type: "jobOperationScrap",
            jobOperationId: job.operationId,
            trackedEntityId: job.unitId,
            quantity: 1,
            scrapReasonId: reason.id,
            inspectionId: lot.id
          });
        }
        expect(
          await f.db
            .selectFrom("productionQuantity")
            .select(["inspectionId", "quantity"])
            .where("companyId", "=", f.companyId)
            .where("jobOperationId", "=", job.operationId)
            .where("type", "=", "Scrap")
            .execute()
        ).toEqual([{ inspectionId: lot.id, quantity: 1 }]);
        expect(
          await f.db
            .selectFrom("trackedEntity")
            .select(["id", "status"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", job.salesItemId)
            .execute()
        ).toEqual([
          { id: job.unitId, status: historical ? "Rejected" : "Scrapped" }
        ]);
        await f.db
          .updateTable("jobOperation")
          .set({ status: "Done", updatedBy: USER })
          .where("companyId", "=", f.companyId)
          .where("id", "=", job.operationId)
          .returning("id")
          .executeTakeFirstOrThrow();
        expect(
          await f.db
            .selectFrom("job")
            .select(["status", "quantityReceivedToInventory"])
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.jobId)
            .executeTakeFirstOrThrow()
        ).toMatchObject({
          status: "Completed",
          quantityReceivedToInventory: 0
        });
        expect(
          await f.db
            .selectFrom("itemLedger")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", job.jobId)
            .where("documentType", "=", "Job Receipt")
            .execute()
        ).toEqual([]);
      } finally {
        await f.cleanup();
      }
    }
  );
}
