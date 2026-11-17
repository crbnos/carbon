// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An operator scraps two tubes out of a kit and replaces them from the shelf.
// The kit stays whole, so the stock movement is a scrap of two tubes from the
// tube's shelf bin, posted to the scrap account, booked once however often
// the request is retried.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  type Fixture,
  alwaysPostFixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("scrap job part", () => {
  let f: Fixture;
  let kitItemId: string;
  let shelfId: string;
  let reasonId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    kitItemId = `${f.prefix}-kit`;
    shelfId = `${f.prefix}-shelf`;
    const rackId = `${f.prefix}-rack`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: kitItemId,
          readableId: `${f.prefix}-KIT`,
          name: "Fuel injector kit",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Make",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: rackId,
            name: "Kit rack",
            kitRack: true,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: shelfId,
            name: "Tube shelf",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("pickMethod")
        .values([
          {
            itemId: kitItemId,
            locationId: f.locationId,
            defaultStorageUnitId: rackId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            itemId: f.partId,
            locationId: f.locationId,
            defaultStorageUnitId: shelfId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .onConflict((oc) =>
          oc
            .columns(["itemId", "locationId"])
            .doUpdateSet((eb) => ({
              defaultStorageUnitId: eb.ref("excluded.defaultStorageUnitId")
            }))
        )
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ unitCost: 4 })
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .execute();
    });

    const method =
      (await f.db
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", kitItemId)
        .executeTakeFirst()) ??
      (await f.db
        .insertInto("makeMethod")
        .values({ itemId: kitItemId, companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow());
    await f.db
      .insertInto("methodMaterial")
      .values({
        makeMethodId: method.id,
        itemId: f.partId,
        methodType: "Pull from Inventory",
        quantity: 5,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();

    reasonId = (
      await f.db
        .insertInto("scrapReason")
        .values({ name: "Bent", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A job that pulls one kit at its operation. */
  async function jobWithKit(key: string) {
    const job = await jobFixture(f, key);
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job.jobId)
      .executeTakeFirstOrThrow();
    const kit = await f.db
      .insertInto("jobMaterial")
      .values({
        jobId: job.jobId,
        jobMakeMethodId: makeMethod.id,
        jobOperationId: job.operationId,
        itemId: kitItemId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        description: "Fuel injector kit",
        quantity: 1,
        estimatedQuantity: 1,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ...job, kitMaterialId: kit.id };
  }

  const scrap = (input: {
    jobOperationId: string;
    materialId: string;
    itemId: string;
    quantity: number;
    replacement: "Shelf" | "Water Spider";
    idempotencyKey: string;
  }) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      { type: "scrapJobPart", scrapReasonId: reasonId, ...input },
      issue
    );

  const scrapRows = (jobId: string) =>
    f.db
      .selectFrom("itemLedger")
      .select(["quantity", "storageUnitId", "scrapReasonId", "documentLineId"])
      .where("documentType", "=", "Scrap")
      .where("documentId", "=", jobId)
      .execute();

  databaseTest(
    "scraps two tubes of a kit from the shelf, once per key",
    async () => {
      const job = await jobWithKit("shelf");
      const input = {
        jobOperationId: job.operationId,
        materialId: job.kitMaterialId,
        itemId: f.partId,
        quantity: 2,
        replacement: "Shelf" as const,
        idempotencyKey: `${f.prefix}-shelf`
      };

      const results = await Promise.all([scrap(input), scrap(input)]);
      expect(results.map((r) => r.error)).toEqual([null, null]);
      expect((await scrap(input)).error).toBeNull();

      const event = await f.db
        .selectFrom("jobMaterialScrap")
        .selectAll()
        .where("idempotencyKey", "=", input.idempotencyKey)
        .execute();
      expect(event).toHaveLength(1);
      expect(Number(event[0].quantity)).toBe(2);
      expect(event[0].materialRequestId).toBeNull();

      const rows = await scrapRows(job.jobId);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].quantity)).toBe(-2);
      expect(rows[0].storageUnitId).toBe(shelfId);
      expect(rows[0].scrapReasonId).toBe(reasonId);
      expect(rows[0].documentLineId).toBe(event[0].id);

      // Two tubes at 4 to the scrap account; the kit line is untouched.
      const scrapLines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("accountId", "=", `${f.prefix}-scrap`)
        .where("documentId", "=", job.jobId)
        .execute();
      expect(scrapLines.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(8);
      const kit = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.kitMaterialId)
        .executeTakeFirstOrThrow();
      expect(Number(kit.quantityIssued ?? 0)).toBe(0);
    }
  );

  databaseTest("asks the water spider for the replacements", async () => {
    const job = await jobWithKit("spider");
    const result = await scrap({
      jobOperationId: job.operationId,
      materialId: job.kitMaterialId,
      itemId: f.partId,
      quantity: 2,
      replacement: "Water Spider",
      idempotencyKey: `${f.prefix}-spider`
    });
    expect(result.error).toBeNull();

    const request = await f.db
      .selectFrom("jobMaterialScrap as s")
      .innerJoin("materialRequest as r", "r.id", "s.materialRequestId")
      .select(["r.itemId", "r.jobOperationId", "r.status", "r.note"])
      .where("s.idempotencyKey", "=", `${f.prefix}-spider`)
      .executeTakeFirstOrThrow();
    expect(request).toEqual({
      itemId: f.partId,
      jobOperationId: job.operationId,
      status: "Open",
      note: "2 to replace scrap"
    });
  });

  databaseTest(
    "scraps a loose material mid-job and leaves what was issued alone",
    async () => {
      // Five tubes on the job, all issued; two get ruined at the weld.
      const job = await jobFixture(f, "loose");
      await f.db
        .updateTable("jobMaterial")
        .set({ quantity: 5, estimatedQuantity: 5, quantityIssued: 5 })
        .where("id", "=", job.materialId)
        .execute();

      const result = await scrap({
        jobOperationId: job.operationId,
        materialId: job.materialId,
        itemId: f.partId,
        quantity: 2,
        replacement: "Shelf",
        idempotencyKey: `${f.prefix}-loose`
      });
      expect(result.error).toBeNull();

      const rows = await scrapRows(job.jobId);
      expect(rows.map((r) => [Number(r.quantity), r.storageUnitId])).toEqual([
        [-2, shelfId]
      ]);
      // The three good tubes and the two replacements still cover the five.
      const tubes = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.materialId)
        .executeTakeFirstOrThrow();
      expect(Number(tubes.quantityIssued)).toBe(5);
    }
  );

  databaseTest("refuses a part that is not in the kit", async () => {
    const job = await jobWithKit("foreign");
    const result = await scrap({
      jobOperationId: job.operationId,
      materialId: job.kitMaterialId,
      itemId: kitItemId,
      quantity: 1,
      replacement: "Shelf",
      idempotencyKey: `${f.prefix}-foreign`
    });
    expect(result.error?.message).toBe(
      "This part cannot be scrapped from this material"
    );
    expect(await scrapRows(job.jobId)).toHaveLength(0);
  });
});
