// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A maintenance dispatch draws a serial or lot from stock at the dispatch's
// location, from a storage unit there that holds the draw. Runs against the
// local database; skipped without one.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest, hasLocalDatabase } from "../fixtures/local-database";
import {
  type LotStockRow,
  lotStock,
  lotStripesIn,
  seedLot
} from "../fixtures/lot-stock";
import { raceBehindRowLock } from "../fixtures/row-lock-race";

describe.skipIf(!hasLocalDatabase)("a maintenance dispatch's lot draw", () => {
  let f: Fixture;
  let itemId: string;
  let dispatchId: string;
  let binA: string;
  let binB: string;
  let otherBin: string;
  let projectId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    itemId = `${f.prefix}-spare`;
    binA = `${f.prefix}-bin-a`;
    binB = `${f.prefix}-bin-b`;
    otherBin = `${f.prefix}-bin-other`;
    projectId = `${f.prefix}-project`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("project")
        .values({
          id: projectId,
          name: "Stocked project",
          identifier: "SP",
          status: "Released",
          costTreatment: "Expense",
          projectStock: true,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("storageUnit")
        .values([
          { id: binA, locationId: f.locationId },
          { id: binB, locationId: f.locationId },
          { id: otherBin, locationId: f.otherLocationId }
        ].map((unit) => ({
          ...unit,
          name: unit.id,
          companyId: f.companyId,
          createdBy: USER
        })))
        .execute();
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: itemId,
          name: "Spare",
          type: "Part",
          itemTrackingType: "Batch",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      const dispatch = await trx
        .insertInto("maintenanceDispatch")
        .values({
          maintenanceDispatchId: `MD-${f.prefix}`,
          severity: "Preventive",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      dispatchId = dispatch.id;
    });
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
      createdBy: USER,
      stock
    });
    return { id, readableId };
  }

  const draw = (
    children: { trackedEntityId: string; quantity: number }[],
    db: Fixture["db"] = f.db
  ) =>
    invokePosting(
      handlesOf({ db, companyId: f.companyId, userId: USER }),
      "issue",
      {
        type: "maintenanceDispatchTrackedEntities",
        maintenanceDispatchId: dispatchId,
        itemId,
        unitOfMeasureCode: "EA",
        children
      },
      issueMaterial
    );

  const stockOf = (lotId: string) => lotStock(f.db, f.companyId, lotId);

  // The posting booked the draw at the dispatch's location against the bin
  // at the other location, which held most of the lot.
  databaseTest(
    "draws from the dispatch's location when the lot has more elsewhere",
    async () => {
      const { id: lotId } = await lot([
        { locationId: f.locationId, storageUnitId: binA, quantity: 5 },
        { locationId: f.otherLocationId, storageUnitId: otherBin, quantity: 7 }
      ]);

      const result = await draw([{ trackedEntityId: lotId, quantity: 4 }]);

      expect(result.error).toBeNull();
      expect(await stockOf(lotId)).toEqual([
        { locationId: f.locationId, storageUnitId: binA, quantity: 1 },
        { locationId: f.otherLocationId, storageUnitId: otherBin, quantity: 7 }
      ]);
    }
  );

  databaseTest("refuses a lot that is in stock at another location", async () => {
    const { id: lotId, readableId } = await lot([
      { locationId: f.otherLocationId, storageUnitId: otherBin, quantity: 5 }
    ]);

    const result = await draw([{ trackedEntityId: lotId, quantity: 2 }]);

    expect(result.error?.message).toBe(
      `${readableId} is in stock at another location. Transfer it to this location first.`
    );
    expect(await stockOf(lotId)).toEqual([
      { locationId: f.otherLocationId, storageUnitId: otherBin, quantity: 5 }
    ]);
  });

  // The lot's total covers the draw; the bin that holds most of it does not.
  databaseTest(
    "refuses a draw larger than the storage unit that holds most of the lot",
    async () => {
      const { id: lotId, readableId } = await lot([
        { locationId: f.locationId, storageUnitId: binA, quantity: 6 },
        { locationId: f.locationId, storageUnitId: binB, quantity: 4 }
      ]);

      const result = await draw([{ trackedEntityId: lotId, quantity: 8 }]);

      expect(result.error?.message).toBe(
        `${readableId} has 6 in one storage unit at this location. Draw no more than that, or move the rest into that storage unit first.`
      );
      expect(await stockOf(lotId)).toEqual([
        { locationId: f.locationId, storageUnitId: binA, quantity: 6 },
        { locationId: f.locationId, storageUnitId: binB, quantity: 4 }
      ]);
    }
  );

  // The draw books unassigned stock. Against the unit's 10 over both stripes,
  // a draw of 8 left the unassigned stock at -2.
  databaseTest(
    "draws no more than the lot's unassigned stock in the storage unit",
    async () => {
      const { id: lotId, readableId } = await lot([
        { locationId: f.locationId, storageUnitId: binA, quantity: 6 },
        {
          locationId: f.locationId,
          storageUnitId: binA,
          quantity: 4,
          projectId
        }
      ]);

      const refused = await draw([{ trackedEntityId: lotId, quantity: 8 }]);
      expect(refused.error?.message).toBe(
        `${readableId} has 6 in one storage unit at this location. Draw no more than that, or move the rest into that storage unit first.`
      );

      const drawn = await draw([{ trackedEntityId: lotId, quantity: 6 }]);
      expect(drawn.error).toBeNull();
      expect(await lotStripesIn(f.db, f.companyId, lotId, binA)).toEqual({
        common: 0,
        [projectId]: 4
      });
    }
  );

  // Read before the other wrote, both split the same 10 and the lot booked
  // -12.
  databaseTest(
    "lets one of two concurrent draws of a lot take its quantity",
    async () => {
      const { id: lotId, readableId } = await lot([
        { locationId: f.locationId, storageUnitId: binA, quantity: 10 }
      ]);

      const take = (db: Fixture["db"]) =>
        draw([{ trackedEntityId: lotId, quantity: 6 }], db);
      const results = await raceBehindRowLock(
        { table: "trackedEntity", id: lotId },
        [take, take]
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
        { locationId: f.locationId, storageUnitId: binA, quantity: 4 }
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
