// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Unconsuming a serial or batch from a job puts it back in the bin its job
// consumption took it from, not in a bin it left earlier (its receipt bin).

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

describe.skipIf(!hasLocalDatabase)("unconsume tracked bin", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values(
          [binA, binB].map((id) => ({
            id,
            name: id.slice(-1).toUpperCase(),
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A job with a tracked material, and one unit of stock received into bin A. */
  async function jobWithStock(key: string, tracking: "Serial" | "Batch") {
    const itemId = `${f.prefix}-item-${key}`;
    const entityId = `${f.prefix}-entity-${key}`;
    const unitId = `${f.prefix}-unit-${key}`;
    const quantity = tracking === "Serial" ? 1 : 4;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: itemId.toUpperCase(),
          name: key,
          type: "Part",
          itemTrackingType: tracking,
          unitOfMeasureCode: "EA",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const job = await jobFixture(f, key);
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job.jobId)
      .executeTakeFirstOrThrow();
    const material = await f.db
      .insertInto("jobMaterial")
      .values({
        jobId: job.jobId,
        jobMakeMethodId: makeMethod.id,
        jobOperationId: job.operationId,
        itemId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        description: key,
        quantity,
        estimatedQuantity: quantity,
        requiresSerialTracking: tracking === "Serial",
        requiresBatchTracking: tracking === "Batch",
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
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
          {
            id: entityId,
            readableId: entityId,
            quantity,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            itemId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("itemLedger")
        .values({
          itemId,
          trackedEntityId: entityId,
          quantity,
          locationId: f.locationId,
          storageUnitId: binA,
          entryType: "Positive Adjmt.",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return { itemId, entityId, unitId, quantity, materialId: material.id };
  }

  /** Moves the entity's stock from one bin to another. */
  const move = (
    s: { itemId: string; entityId: string; quantity: number },
    from: string,
    to: string
  ) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values(
          [
            { storageUnitId: from, quantity: -s.quantity },
            { storageUnitId: to, quantity: s.quantity }
          ].map((row) => ({
            ...row,
            itemId: s.itemId,
            trackedEntityId: s.entityId,
            locationId: f.locationId,
            entryType: "Transfer" as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );

  const post = (
    type: "trackedEntitiesToOperation" | "unconsumeTrackedEntities",
    s: { materialId: string; unitId: string; entityId: string; quantity: number }
  ) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type,
        materialId: s.materialId,
        parentTrackedEntityId: s.unitId,
        children: [{ trackedEntityId: s.entityId, quantity: s.quantity }],
        ...(type === "trackedEntitiesToOperation"
          ? { allowOverIssue: true }
          : {})
      },
      issue
    );

  /** Net stock of the entity per bin, leaving out empty bins. */
  const stockByBin = async (entityId: string) => {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "quantity"])
      .where("trackedEntityId", "=", entityId)
      .where("companyId", "=", f.companyId)
      .execute();
    const net = new Map<string | null, number>();
    for (const row of rows) {
      net.set(
        row.storageUnitId,
        (net.get(row.storageUnitId) ?? 0) + Number(row.quantity)
      );
    }
    return Object.fromEntries([...net].filter(([, quantity]) => quantity !== 0));
  };

  for (const tracking of ["Serial", "Batch"] as const) {
    databaseTest(
      `returns a ${tracking.toLowerCase()} moved after its receipt to the bin it was consumed from`,
      async () => {
        const s = await jobWithStock(tracking.toLowerCase(), tracking);
        await move(s, binA, binB);

        expect((await post("trackedEntitiesToOperation", s)).error).toBeNull();
        expect(await stockByBin(s.entityId)).toEqual({});

        expect((await post("unconsumeTrackedEntities", s)).error).toBeNull();
        expect(await stockByBin(s.entityId)).toEqual({ [binB]: s.quantity });
      }
    );
  }

  databaseTest(
    "returns a serial consumed twice to the bin of its latest consumption",
    async () => {
      const s = await jobWithStock("twice", "Serial");
      await move(s, binA, binB);
      expect((await post("trackedEntitiesToOperation", s)).error).toBeNull();
      expect((await post("unconsumeTrackedEntities", s)).error).toBeNull();
      expect(await stockByBin(s.entityId)).toEqual({ [binB]: 1 });

      await move(s, binB, binA);
      expect((await post("trackedEntitiesToOperation", s)).error).toBeNull();
      expect((await post("unconsumeTrackedEntities", s)).error).toBeNull();
      expect(await stockByBin(s.entityId)).toEqual({ [binA]: 1 });
    }
  );
});
