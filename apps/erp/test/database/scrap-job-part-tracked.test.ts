// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Scrapping tracked parts at an operation: the serial or batch that was used
// is the one scrapped, its cost leaves WIP, and the job needs a replacement
// scanned in.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("scrap tracked job parts", () => {
  let f: Fixture;
  let serialItemId: string;
  let batchItemId: string;
  let reasonId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    serialItemId = `${f.prefix}-tube`;
    batchItemId = `${f.prefix}-wire`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values([
          {
            id: serialItemId,
            readableId: `${f.prefix}-TUBE`,
            name: "Tube",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: batchItemId,
            readableId: `${f.prefix}-WIRE`,
            name: "Filler wire",
            type: "Part",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ unitCost: 10 })
        .where("itemId", "in", [serialItemId, batchItemId])
        .where("companyId", "=", f.companyId)
        .execute();
    });
    reasonId = (
      await f.db
        .insertInto("scrapReason")
        .values({ name: "Bad weld", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A job unit, a tracked material on it, and stock of that item. */
  async function jobWithTracked(
    key: string,
    itemId: string,
    stock: { id: string; quantity: number }[]
  ) {
    const job = await jobFixture(f, key);
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job.jobId)
      .executeTakeFirstOrThrow();
    const tracking = itemId === serialItemId ? "Serial" : "Batch";
    const material = await f.db
      .insertInto("jobMaterial")
      .values({
        jobId: job.jobId,
        jobMakeMethodId: makeMethod.id,
        jobOperationId: job.operationId,
        itemId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        description: tracking,
        quantity: 5,
        estimatedQuantity: 5,
        requiresSerialTracking: tracking === "Serial",
        requiresBatchTracking: tracking === "Batch",
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const unitId = `${f.prefix}-unit-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values([
          {
            id: unitId,
            quantity: 1,
            status: "Reserved",
            sourceDocument: "Item",
            sourceDocumentId: f.assemblyId,
            itemId: f.assemblyId,
            companyId: f.companyId,
            createdBy: USER
          },
          ...stock.map((s) => ({
            id: s.id,
            readableId: s.id,
            quantity: s.quantity,
            status: "Available" as const,
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            itemId,
            companyId: f.companyId,
            createdBy: USER
          }))
        ])
        .execute();
      if (stock.length === 0) return;
      await trx
        .insertInto("itemLedger")
        .values(
          stock.map((s) => ({
            itemId,
            trackedEntityId: s.id,
            quantity: s.quantity,
            locationId: f.locationId,
            entryType: "Positive Adjmt." as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return { ...job, trackedMaterialId: material.id, unitId };
  }

  const consume = (
    materialId: string,
    unitId: string,
    children: { trackedEntityId: string; quantity: number }[]
  ) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type: "trackedEntitiesToOperation",
        materialId,
        parentTrackedEntityId: unitId,
        children,
        allowOverIssue: true
      },
      issue
    );

  const scrap = (
    jobOperationId: string,
    lines: { materialId: string; trackedEntityId: string; quantity: number }[],
    idempotencyKey: string
  ) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type: "scrapJobPart",
        jobOperationId,
        lines,
        scrapReasonId: reasonId,
        replacement: "Shelf",
        idempotencyKey
      },
      issue
    );

  const issued = async (materialId: string) =>
    Number(
      (
        await f.db
          .selectFrom("jobMaterial")
          .select("quantityIssued")
          .where("id", "=", materialId)
          .executeTakeFirstOrThrow()
      ).quantityIssued
    );

  const scrapToAccount = async (jobId: string) =>
    (
      await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("accountId", "=", `${f.prefix}-scrap`)
        .where("documentId", "=", jobId)
        .execute()
    ).reduce((sum, l) => sum + Number(l.amount), 0);

  databaseTest(
    "scraps the ruined serials and reopens them for a scan",
    async () => {
      const serials = ["a", "b", "c"].map((s) => `${f.prefix}-tube-${s}`);
      const job = await jobWithTracked(
        "serial",
        serialItemId,
        serials.map((id) => ({ id, quantity: 1 }))
      );
      expect(
        (
          await consume(
            job.trackedMaterialId,
            job.unitId,
            serials.map((id) => ({ trackedEntityId: id, quantity: 1 }))
          )
        ).error
      ).toBeNull();
      expect(await issued(job.trackedMaterialId)).toBe(3);

      const lines = serials.slice(0, 2).map((id) => ({
        materialId: job.trackedMaterialId,
        trackedEntityId: id,
        quantity: 1
      }));
      expect(
        (await scrap(job.operationId, lines, `${f.prefix}-s`)).error
      ).toBeNull();
      expect(
        (await scrap(job.operationId, lines, `${f.prefix}-s`)).error
      ).toBeNull();

      const statuses = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "status"])
        .where("id", "in", serials)
        .orderBy("id")
        .execute();
      expect(statuses.map((s) => s.status)).toEqual([
        "Scrapped",
        "Scrapped",
        "Consumed"
      ]);
      // The two replacements are needed again; the good one stays issued.
      expect(await issued(job.trackedMaterialId)).toBe(1);
      expect(await scrapToAccount(job.jobId)).toBe(20);

      // Scrapped serials are no longer offered.
      const again = await scrap(
        job.operationId,
        [lines[0]],
        `${f.prefix}-s-again`
      );
      expect(again.error?.message).toBe(
        "This serial or batch was not used at this operation"
      );
    }
  );

  databaseTest("scraps part of a batch that was used", async () => {
    const lot = `${f.prefix}-lot`;
    const job = await jobWithTracked("batch", batchItemId, [
      { id: lot, quantity: 5 }
    ]);
    expect(
      (
        await consume(job.trackedMaterialId, job.unitId, [
          { trackedEntityId: lot, quantity: 3 }
        ])
      ).error
    ).toBeNull();
    const consumed = await f.db
      .selectFrom("trackedEntity")
      .select(["id", "quantity"])
      .where("itemId", "=", batchItemId)
      .where("status", "=", "Consumed")
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(Number(consumed.quantity)).toBe(3);

    const result = await scrap(
      job.operationId,
      [
        {
          materialId: job.trackedMaterialId,
          trackedEntityId: consumed.id,
          quantity: 2
        }
      ],
      `${f.prefix}-b`
    );
    expect(result.error).toBeNull();

    const pieces = await f.db
      .selectFrom("trackedEntity")
      .select(["status", "quantity"])
      .where("itemId", "=", batchItemId)
      .where("status", "in", ["Consumed", "Scrapped"])
      .where("companyId", "=", f.companyId)
      .orderBy("status")
      .execute();
    expect(pieces.map((p) => [p.status, Number(p.quantity)])).toEqual([
      ["Consumed", 1],
      ["Scrapped", 2]
    ]);
    expect(await issued(job.trackedMaterialId)).toBe(1);
    expect(await scrapToAccount(job.jobId)).toBe(20);
  });

  databaseTest(
    "scraps a serial inside a kit serial and asks for its replacement",
    async () => {
      const kitItemId = `${f.prefix}-kit`;
      const rackId = `${f.prefix}-rack`;
      const kitSerial = `${f.prefix}-kit-1`;
      const tube = `${f.prefix}-kit-tube`;
      const job = await jobWithTracked("kit", serialItemId, []);
      const makeMethod = await f.db
        .selectFrom("jobMakeMethod")
        .select("id")
        .where("jobId", "=", job.jobId)
        .executeTakeFirstOrThrow();
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: kitItemId,
            readableId: `${f.prefix}-KIT`,
            name: "Kit",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Make",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("storageUnit")
          .values({
            id: rackId,
            name: "Kit rack",
            kitRack: true,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("pickMethod")
          .values({
            itemId: kitItemId,
            locationId: f.locationId,
            defaultStorageUnitId: rackId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values(
            [kitSerial, tube].map((id) => ({
              id,
              readableId: id,
              quantity: 1,
              status: "Consumed" as const,
              sourceDocument: "Item",
              sourceDocumentId: id === tube ? serialItemId : kitItemId,
              itemId: id === tube ? serialItemId : kitItemId,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      const kitMaterial = await f.db
        .insertInto("jobMaterial")
        .values({
          jobId: job.jobId,
          jobMakeMethodId: makeMethod.id,
          jobOperationId: job.operationId,
          itemId: kitItemId,
          itemType: "Part",
          methodType: "Pull from Inventory",
          description: "Kit",
          quantity: 1,
          estimatedQuantity: 1,
          quantityIssued: 1,
          requiresSerialTracking: true,
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      // The tube went into the kit when it was built; the kit went into the
      // unit on this job.
      const genealogy = [
        { id: `${f.prefix}-built`, source: "kit-job-material", input: tube, output: kitSerial },
        { id: `${f.prefix}-used`, source: kitMaterial.id, input: kitSerial, output: job.unitId }
      ];
      for (const g of genealogy) {
        await f.db
          .insertInto("trackedActivity")
          .values({
            id: g.id,
            type: "Consume",
            sourceDocument: "Job Material",
            sourceDocumentId: g.source,
            attributes: {},
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await f.db
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: g.id,
            trackedEntityId: g.input,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await f.db
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: g.id,
            trackedEntityId: g.output,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      }

      const result = await scrap(
        job.operationId,
        [{ materialId: kitMaterial.id, trackedEntityId: tube, quantity: 1 }],
        `${f.prefix}-k`
      );
      expect(result.error).toBeNull();

      const scrapped = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", tube)
        .executeTakeFirstOrThrow();
      expect(scrapped.status).toBe("Scrapped");
      // The kit serial stays used; the job needs a tube scanned in. The
      // tube material on the job takes the extra requirement.
      const tubes = await f.db
        .selectFrom("jobMaterial")
        .select(["id", "estimatedQuantity"])
        .where("jobMakeMethodId", "=", makeMethod.id)
        .where("itemId", "=", serialItemId)
        .execute();
      expect(tubes.map((t) => Number(t.estimatedQuantity))).toEqual([6]);
      expect(await scrapToAccount(job.jobId)).toBe(10);
    }
  );
});
