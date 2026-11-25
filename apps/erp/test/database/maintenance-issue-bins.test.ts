// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A maintenance spare-part issue took its whole quantity from the single
// fullest bin, ignoring the item's default and never splitting, so that bin
// went negative while another bin kept stock. It now draws like any untracked
// consumption: the nettable default, then the fullest bins, split across
// them, never a quarantine unit. The un-issue puts each part back where it
// was drawn.

import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

describe.skipIf(!hasLocalDatabase)("maintenance spare-part issue bins", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let quarantine: string;
  let dispatchId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    quarantine = `${f.prefix}-quarantine`;
    dispatchId = `${f.prefix}-dispatch`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: binA,
            name: "A",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: binB,
            name: "B",
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
      await trx
        .insertInto("maintenanceDispatch")
        .values({
          id: dispatchId,
          maintenanceDispatchId: "MD-1",
          status: "Open",
          source: "Reactive",
          severity: "Support Required",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** An untracked spare part with `stock` on hand per bin. */
  async function partWith(
    key: string,
    stock: Array<[string, number]>,
    defaultBin?: string
  ): Promise<string> {
    const itemId = `${f.prefix}-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: `${f.prefix}-${key.toUpperCase()}`,
          name: key,
          type: "Part",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("itemLedger")
        .values(
          stock.map(([storageUnitId, quantity]) => ({
            entryType: "Positive Adjmt." as const,
            itemId,
            locationId: f.locationId,
            storageUnitId,
            quantity,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      if (defaultBin) {
        await trx
          .insertInto("pickMethod")
          .values({
            itemId,
            locationId: f.locationId,
            defaultStorageUnitId: defaultBin,
            companyId: f.companyId,
            createdBy: USER
          })
          .onConflict((oc) =>
            oc
              .columns(["itemId", "locationId"])
              .doUpdateSet({ defaultStorageUnitId: defaultBin })
          )
          .execute();
      }
    });
    return itemId;
  }

  const issueToDispatch = (itemId: string, quantity: number) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type: "maintenanceDispatchInventory",
        maintenanceDispatchId: dispatchId,
        itemId,
        unitOfMeasureCode: "EA",
        quantity
      },
      issue
    ).then(unwrap);

  /** On-hand per bin. */
  async function onHand(itemId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .groupBy("storageUnitId")
      .select(["storageUnitId", (eb) => eb.fn.sum<number>("quantity").as("q")])
      .execute();
    return Object.fromEntries(
      rows.map((r) => [r.storageUnitId ?? "none", Number(r.q)])
    );
  }

  databaseTest(
    "with no default, takes the fullest bin first and the rest from the next",
    async () => {
      const itemId = await partWith("no-default", [
        [binA, 2],
        [binB, 5]
      ]);

      await issueToDispatch(itemId, 6);

      const consumed = await f.db
        .selectFrom("itemLedger")
        .where("itemId", "=", itemId)
        .where("documentType", "=", "Maintenance Consumption")
        .where("companyId", "=", f.companyId)
        .select(["storageUnitId", "quantity"])
        .orderBy("quantity")
        .execute();
      expect(
        consumed.map((row) => [row.storageUnitId, Number(row.quantity)])
      ).toEqual([
        [binB, -5],
        [binA, -1]
      ]);
      expect(await onHand(itemId)).toEqual({ [binA]: 1, [binB]: 0 });
    }
  );

  databaseTest("prefers the item's nettable default bin", async () => {
    const itemId = await partWith(
      "default",
      [
        [binA, 2],
        [binB, 5]
      ],
      binA
    );

    await issueToDispatch(itemId, 3);

    expect(await onHand(itemId)).toEqual({ [binA]: 0, [binB]: 4 });
  });

  databaseTest("never takes stock from a quarantine unit", async () => {
    const itemId = await partWith("quarantine", [
      [quarantine, 10],
      [binA, 1]
    ]);

    await issueToDispatch(itemId, 3);

    // The shortfall stays on the bin it drew from, not in quarantine.
    expect(await onHand(itemId)).toEqual({ [quarantine]: 10, [binA]: -2 });
  });

  databaseTest(
    "an un-issue puts back each part in the bin it came from",
    async () => {
      const itemId = await partWith("unissue", [
        [binA, 2],
        [binB, 5]
      ]);
      await issueToDispatch(itemId, 6);
      const dispatchItem = await f.db
        .selectFrom("maintenanceDispatchItem")
        .where("maintenanceDispatchId", "=", dispatchId)
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .select("id")
        .executeTakeFirstOrThrow();

      await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "maintenanceDispatchUnissue",
          maintenanceDispatchItemId: dispatchItem.id
        },
        issue
      ).then(unwrap);

      expect(await onHand(itemId)).toEqual({ [binA]: 2, [binB]: 5 });
    }
  );
});
