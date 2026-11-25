// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A service job draws a serial or lot from stock at the job's location, from
// a storage unit there that holds the draw. Runs against the local database;
// skipped without one.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest, hasLocalDatabase } from "../fixtures/local-database";
import { type LotStockRow, lotStock, seedLot } from "../fixtures/lot-stock";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { raceBehindRowLock } from "../fixtures/row-lock-race";
import { serviceJobFixture } from "../fixtures/service-job";

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

describe.skipIf(!hasLocalDatabase)("a service job's lot draw", () => {
  let f: Fixture;
  let itemId: string;
  let locationId: string;
  let otherLocationId: string;
  let binA: string;
  let binB: string;
  let otherBin: string;

  beforeAll(async () => {
    f = await serviceJobFixture();
    ({ itemId, locationId } = await f.addStockedItem("spare", {
      quantity: 0,
      unitCost: 10
    }));
    ({ locationId: otherLocationId } = await f.addStockedItem("elsewhere", {
      quantity: 0,
      unitCost: 10
    }));
    binA = `${f.prefix}-bin-a`;
    binB = `${f.prefix}-bin-b`;
    otherBin = `${f.prefix}-bin-other`;
    await f.db
      .updateTable("item")
      .set({ itemTrackingType: "Batch" })
      .where("id", "=", itemId)
      .where("companyId", "=", f.companyId)
      .execute();
    await f.db
      .insertInto("storageUnit")
      .values(
        [
          { id: binA, locationId },
          { id: binB, locationId },
          { id: otherBin, locationId: otherLocationId }
        ].map((unit) => ({
          ...unit,
          name: unit.id,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        }))
      )
      .execute();
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  let lots = 0;
  /** A lot of the spare, its quantity the sum of its stock rows. */
  async function lot(stock: LotStockRow[]) {
    const id = `${f.prefix}-lot-${++lots}`;
    const readableId = `LOT-${lots}`;
    await seedLot(f.db, {
      id,
      readableId,
      itemId,
      companyId: f.companyId,
      createdBy: PROJECT_TEST_USER,
      stock
    });
    return { id, readableId };
  }

  const draw = (
    serviceJobId: string,
    children: { trackedEntityId: string; quantity: number }[],
    db: Fixture["db"] = f.db
  ) =>
    invokePosting(
      handlesOf({ db, companyId: f.companyId, userId: PROJECT_TEST_USER }),
      "issue",
      {
        type: "serviceJobTrackedEntities",
        serviceJobId,
        itemId,
        unitOfMeasureCode: "EA",
        children
      },
      issueMaterial
    );

  const stockOf = (lotId: string) => lotStock(f.db, f.companyId, lotId);

  // The posting booked the draw at the job's location against the bin at the
  // other location, which held most of the lot.
  databaseTest(
    "draws from the job's location when the lot has more elsewhere",
    async () => {
      const { id: lotId } = await lot([
        { locationId, storageUnitId: binA, quantity: 5 },
        { locationId: otherLocationId, storageUnitId: otherBin, quantity: 7 }
      ]);
      const job = await f.addJob({ locationId });

      const result = await draw(job.id, [
        { trackedEntityId: lotId, quantity: 4 }
      ]);

      expect(result.error).toBeNull();
      expect(await stockOf(lotId)).toEqual([
        { locationId, storageUnitId: binA, quantity: 1 },
        { locationId: otherLocationId, storageUnitId: otherBin, quantity: 7 }
      ]);
    }
  );

  databaseTest("refuses a lot that is in stock at another location", async () => {
    const { id: lotId, readableId } = await lot([
      { locationId: otherLocationId, storageUnitId: otherBin, quantity: 5 }
    ]);
    const job = await f.addJob({ locationId });

    const result = await draw(job.id, [{ trackedEntityId: lotId, quantity: 2 }]);

    expect(result.error?.message).toBe(
      `${readableId} is in stock at another location. Transfer it to this location first.`
    );
    expect(await stockOf(lotId)).toEqual([
      { locationId: otherLocationId, storageUnitId: otherBin, quantity: 5 }
    ]);
  });

  // The lot's total covers the draw; the bin that holds most of it does not.
  databaseTest(
    "refuses a draw larger than the storage unit that holds most of the lot",
    async () => {
      const { id: lotId, readableId } = await lot([
        { locationId, storageUnitId: binA, quantity: 6 },
        { locationId, storageUnitId: binB, quantity: 4 }
      ]);
      const job = await f.addJob({ locationId });

      const result = await draw(job.id, [
        { trackedEntityId: lotId, quantity: 8 }
      ]);

      expect(result.error?.message).toBe(
        `${readableId} has 6 in one storage unit at this location. Draw no more than that, or move the rest into that storage unit first.`
      );
      expect(await stockOf(lotId)).toEqual([
        { locationId, storageUnitId: binA, quantity: 6 },
        { locationId, storageUnitId: binB, quantity: 4 }
      ]);
    }
  );

  // Two jobs, so the job lock does not order the draws. Read before the other
  // wrote, both split the same 10 and the lot booked -12.
  databaseTest(
    "lets one of two concurrent draws of a lot take its quantity",
    async () => {
      const { id: lotId, readableId } = await lot([
        { locationId, storageUnitId: binA, quantity: 10 }
      ]);
      const [first, second] = [
        await f.addJob({ locationId }),
        await f.addJob({ locationId })
      ];

      const results = await raceBehindRowLock(
        { table: "trackedEntity", id: lotId },
        [first!, second!].map(
          (job) => (db: Fixture["db"]) =>
            draw(job.id, [{ trackedEntityId: lotId, quantity: 6 }], db)
        )
      );

      expect(
        results.map((result) => result.error?.message ?? null).sort()
      ).toEqual(
        [
          null,
          `${readableId} has 4 in one storage unit at this location. Draw no more than that, or move the rest into that storage unit first.`
        ].sort()
      );
      expect(await stockOf(lotId)).toEqual([
        { locationId, storageUnitId: binA, quantity: 4 }
      ]);
      const parent = await f.db
        .selectFrom("trackedEntity")
        .select("quantity")
        .where("id", "=", lotId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(parent.quantity)).toBe(4);
    }
  );
});
