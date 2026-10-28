// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// When no bin was chosen, an issue, a backflush, a maintenance issue and a new
// job material fall back to the item's fullest bin. That guess must never be a
// non-nettable (quarantine) unit, or quarantined stock is consumed silently.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import {
  getStorageUnitWithHighestQuantity,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("fullest bin guess", () => {
  let f: Fixture;
  let warehouse: string;
  let quarantine: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    warehouse = `${f.prefix}-warehouse`;
    quarantine = `${f.prefix}-quarantine`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: warehouse,
            name: "Warehouse",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: quarantine,
            name: "Quarantine",
            locationId: f.locationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const receive = (itemId: string, storageUnitId: string, quantity: number) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          entryType: "Positive Adjmt.",
          documentType: "Inventory Receipt",
          itemId,
          locationId: f.locationId,
          storageUnitId,
          quantity,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  const guess = (itemId: string) =>
    f.db
      .transaction()
      .execute((trx) =>
        getStorageUnitWithHighestQuantity(trx, itemId, f.locationId)
      );

  databaseTest("passes over a fuller non-nettable unit", async () => {
    await receive(f.partId, warehouse, 5);
    await receive(f.partId, quarantine, 30);

    expect(await guess(f.partId)).toBe(warehouse);
  });

  databaseTest(
    "guesses nothing when only a non-nettable unit has stock",
    async () => {
      await receive(f.assemblyId, quarantine, 12);

      expect(await guess(f.assemblyId)).toBeNull();
    }
  );

  databaseTest(
    "a backflush short in the guessed bin does not fall back to a non-nettable unit",
    async () => {
      // Its own stock: 1 nettable unit against a need of 2, 30 in quarantine.
      const item = `${f.prefix}-backflushed`;
      await seed(f, (trx) =>
        trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-BF`,
            name: "Backflushed part",
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      await receive(item, warehouse, 1);
      await receive(item, quarantine, 30);
      const job = await jobFixture(f, "backflush");
      await f.db
        .updateTable("jobMaterial")
        .set({ itemId: item })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity"])
        .where("itemId", "=", item)
        .where("documentType", "=", "Job Consumption")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(consumed).toEqual([{ storageUnitId: warehouse, quantity: -2 }]);
    }
  );
});
