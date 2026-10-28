// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// When no bin was chosen, an issue, a backflush, a maintenance issue and a new
// job material fall back to the item's fullest bin. That guess must never be a
// non-nettable (quarantine) unit, or quarantined stock is consumed silently.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { afterAll, beforeAll, describe, expect } from "vitest";
import { getStorageUnitWithHighestQuantity } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
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

  const receive = (storageUnitId: string, quantity: number) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          entryType: "Positive Adjmt.",
          documentType: "Inventory Receipt",
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId,
          quantity,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  databaseTest("passes over a fuller non-nettable unit", async () => {
    await receive(warehouse, 5);
    await receive(quarantine, 30);

    const guess = await f.db
      .transaction()
      .execute((trx) =>
        getStorageUnitWithHighestQuantity(trx, f.partId, f.locationId)
      );
    expect(guess).toBe(warehouse);
  });

  databaseTest("guesses nothing when only a non-nettable unit has stock", async () => {
    await receive(warehouse, -5);

    const guess = await f.db
      .transaction()
      .execute((trx) =>
        getStorageUnitWithHighestQuantity(trx, f.partId, f.locationId)
      );
    expect(guess).toBeNull();
  });
});
