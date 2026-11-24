// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  issueMaterial,
  postInventoryAdjustment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";

type Job = Awaited<ReturnType<typeof createPairedJob>>;

function issue(f: Fixture, job: Job, sourceId: string, outputId = job.unitId) {
  return invokePosting(
    handlesOf(f.ctx),
    "issue",
    {
      type: "trackedEntitiesToOperation",
      materialId: job.materialId,
      jobOperationId: job.operationId,
      parentTrackedEntityId: outputId,
      children: [{ trackedEntityId: sourceId, quantity: 1 }],
      allowOverIssue: true
    },
    issueMaterial
  );
}
function complete(f: Fixture, job: Job) {
  return invokePosting(
    handlesOf(f.ctx),
    "issue",
    {
      type: "jobOperationSerialComplete",
      jobOperationId: job.operationId,
      trackedEntityId: job.unitId,
      quantity: 1
    },
    issueMaterial
  );
}

databaseTest(
  "a scan binds one exact source to the selected piece of a multi-piece job",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const wrong = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: f.partId,
          sourceDocument: "Item",
          sourceDocumentId: f.partId,
          readableId: "OTHER",
          quantity: 1,
          status: "Available",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, wrong.id!)).error).toBeTruthy();
      const changeSource = () =>
        f.db
          .updateTable("trackedEntity")
          .where("companyId", "=", f.companyId)
          .where("id", "=", production.first.id!);
      const rejectSource = async () =>
        expect((await issue(f, job, production.first.id!)).error).toBeTruthy();
      await changeSource().set({ readableId: "   " }).execute();
      await rejectSource();
      await changeSource()
        .set({ readableId: production.first.serial, quantity: 2 })
        .execute();
      await rejectSource();
      await changeSource().set({ quantity: 1, status: "On Hold" }).execute();
      await rejectSource();
      const original = await f.db
        .selectFrom("trackedEntity")
        .select("attributes")
        .where("id", "=", production.first.id!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await changeSource()
        .set({
          status: "Available",
          attributes: {
            ...(original.attributes as Record<string, string>),
            Shipment: "draft"
          }
        })
        .execute();
      await rejectSource();
      await changeSource().set({ attributes: original.attributes }).execute();

      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      expect((await issue(f, job, production.second.id!)).error).toBeTruthy();
      const offPlan = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "trackedEntitiesToOperation",
          itemId: production.productionItemId,
          jobOperationId: job.operationId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: production.second.id!, quantity: 1 }],
          allowOverIssue: true
        },
        issueMaterial
      );
      expect(offPlan.error?.message).toContain("planned pack-out material");
      const units = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "quantity", "readableId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .orderBy("createdAt")
        .execute();
      expect(units).toEqual([
        { id: job.unitId, quantity: 1, readableId: production.first.serial },
        { id: expect.any(String), quantity: 1, readableId: null }
      ]);
      expect(
        (await issue(f, job, production.first.id!, units[1]!.id!)).error
      ).toBeTruthy();
      const consumption = await f.db
        .selectFrom("itemLedger")
        .select(["trackedEntityId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .where("documentType", "=", "Job Consumption")
        .execute();
      expect(consumption).toEqual([
        { trackedEntityId: production.first.id, quantity: -1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "returning a paired source restores its own FIFO layer at its issued cost",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const source = production.first.id!;
      // Provenance can name the original job while itemId identifies its SKU.
      await f.db
        .updateTable("trackedEntity")
        .set({ sourceDocument: "Job", sourceDocumentId: production.jobId })
        .where("id", "=", source)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await f.db
        .updateTable("trackedEntity")
        .set({ readableId: production.first.serial })
        .where("companyId", "=", f.companyId)
        .where("id", "=", job.unitId)
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, source)).error).toBeNull();
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 87 })
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", production.productionItemId)
        .returning("itemId")
        .executeTakeFirstOrThrow();
      const activePair = () =>
        f.db
          .selectFrom("jobUnitPairing")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("outputId", "=", job.unitId)
          .where("releasedAt", "is", null)
          .executeTakeFirstOrThrow();
      const giveBack = (pairingId?: string) =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "unconsumeTrackedEntities",
            materialId: job.materialId,
            parentTrackedEntityId: job.unitId,
            pairingId,
            children: [{ trackedEntityId: source, quantity: 1 }]
          },
          issueMaterial
        );
      const firstPair = await activePair();
      expect((await giveBack(firstPair.id)).error).toBeNull();
      const output = await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output.readableId).toBe(production.first.serial);
      const layer = () =>
        f.db
          .selectFrom("costLedger")
          .select(["cost", "remainingQuantity"])
          .where("companyId", "=", f.companyId)
          .where("trackedEntityId", "=", source)
          .where("documentType", "=", "Job Consumption")
          .where("documentId", "=", job.jobId)
          .where("quantity", "=", 1)
          .executeTakeFirstOrThrow();
      expect(await layer()).toEqual({ cost: 20, remainingQuantity: 1 });
      expect((await issue(f, job, source)).error).toBeNull();
      expect(await layer()).toEqual({ cost: 20, remainingQuantity: 0 });
      const replacementPair = await activePair();
      expect((await giveBack(firstPair.id)).error).toBeTruthy();
      expect((await giveBack()).error).toBeTruthy();
      expect(await activePair()).toEqual(replacementPair);
      expect((await giveBack(replacementPair.id)).error).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "scrap followed by recovery cannot number the old output until its replacement is scanned",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const reason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      const scrap = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "scrapTrackedEntity",
          trackedEntityId: production.first.id!,
          materialId: job.materialId,
          parentTrackedEntityId: job.unitId,
          scrapReasonId: reason.id
        },
        issueMaterial
      );
      expect(scrap.error).toBeNull();
      const recovered = await invokePosting(
        handlesOf(f.ctx),
        "post-inventory-adjustment",
        {
          adjustmentType: "Unscrap",
          quantity: 1,
          itemId: production.productionItemId,
          locationId: f.locationId,
          trackedEntityId: production.first.id!
        },
        postInventoryAdjustment
      );
      expect(recovered.error).toBeNull();
      expect((await complete(f, job)).error).toBeTruthy();
      const output = await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output.readableId).toBeNull();
      expect((await issue(f, job, production.second.id!)).error).toBeNull();
      expect((await complete(f, job)).error).toBeNull();
      const links = await f.db
        .selectFrom("jobUnitPairing")
        .select(["sourceId", "releasedAt"])
        .where("companyId", "=", f.companyId)
        .where("outputId", "=", job.unitId)
        .orderBy("serial")
        .execute();
      expect(links).toEqual([
        { sourceId: production.first.id, releasedAt: expect.anything() },
        { sourceId: production.second.id, releasedAt: null }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a competing manual serial edit cannot erase a paired unit's completion marker",
  async () => {
    const f = await alwaysPostFixture();
    const editor = await connectLocalTestDatabase();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
        editor
      );
      const {
        rows: [mes]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() as pid`.execute(
        f.db
      );
      let result: ReturnType<typeof complete> | undefined;
      try {
        // The planner starts a save while MES is completing. A matching value
        // is a harmless save; changing a serial with an active pair is refused.
        await editor.transaction().execute(async (trx) => {
          await trx
            .selectFrom("trackedEntity")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          result = complete(f, job);
          await expect
            .poll(
              async () => {
                const {
                  rows: [r]
                } = await sql<{
                  blocked: boolean;
                }>`SELECT pg_backend_pid()=ANY(pg_blocking_pids(${mes!.pid})) AS blocked`.execute(
                  trx
                );
                return r?.blocked;
              },
              { timeout: 5000 }
            )
            .toBe(true);
          await trx
            .updateTable("trackedEntity")
            .set({ readableId: production.first.serial })
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .returning("id")
            .executeTakeFirstOrThrow();
        });
      } finally {
        if (result) expect((await result).error).toBeNull();
      }
      await expect(
        editor
          .updateTable("trackedEntity")
          .set({ readableId: "MANUAL" })
          .where("companyId", "=", f.companyId)
          .where("id", "=", job.unitId)
          .execute()
      ).rejects.toThrow();
      expect((await complete(f, job)).error).toBeNull();
      const reported = await f.db
        .selectFrom("productionQuantity")
        .select("quantity")
        .where("companyId", "=", f.companyId)
        .where("jobOperationId", "=", job.operationId)
        .where("type", "=", "Production")
        .execute();
      expect(reported).toEqual([{ quantity: 1 }]);
    } finally {
      await editor.destroy();
      await f.cleanup();
    }
  }
);
