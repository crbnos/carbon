// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postAssetTransfer from "../post-asset-transfer";
import { chargeFixture } from "../post-charge/post-charge-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import previewAssetCapitalization from "./index";

type Fixture = Awaited<ReturnType<typeof chargeFixture>>;

// A FIFO serial item whose unit cost (100) is NOT what either unit carries:
// one unit has its own layer at 60, the other has none and the item's unit
// cost is the fallback. Accounting is off, so no posting setup is needed.
async function capitalizationFixture(f: Fixture, unitCost: number) {
  const { db, companyId } = f;
  await db
    .updateTable("companySettings")
    .set({ accountingEnabled: false })
    .where("id", "=", companyId)
    .execute();

  const item = await db
    .insertInto("item")
    .values({
      readableId: `${companyId}-RW`,
      name: "Reaction Wheel",
      type: "Part",
      itemTrackingType: "Serial",
      replenishmentSystem: "Buy",
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.deleteFrom("itemCost").where("itemId", "=", item.id).execute();
  await db
    .insertInto("itemCost")
    .values({
      itemId: item.id,
      costingMethod: "FIFO",
      unitCost,
      companyId,
      createdBy: "system"
    })
    .execute();

  const location = await db
    .insertInto("location")
    .values({
      name: "Plant",
      addressLine1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const assetClass = await db
    .insertInto("fixedAssetClass")
    .values({
      name: "Rental Fleet",
      assetAccountId: f.account("expense"),
      accumulatedDepreciationAccountId: f.account("expense"),
      depreciationExpenseAccountId: f.account("expense"),
      writeOffAccountId: f.account("expense"),
      writeDownAccountId: f.account("expense"),
      lossOnDisposalAccountId: f.account("expense"),
      gainOnDisposalAccountId: f.account("income"),
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("sequence")
    .values([
      { table: "fixedAsset", name: "Fixed Asset", prefix: "FA", companyId },
      {
        table: "fixedAssetTransfer",
        name: "Fixed Asset Transfer",
        prefix: "FAT",
        companyId
      }
    ])
    .execute();

  const unit = async (readableId: string) => {
    const entity = await db
      .insertInto("trackedEntity")
      .values({
        readableId,
        itemId: item.id,
        quantity: 1,
        sourceDocument: "Item",
        sourceDocumentId: item.id,
        companyId,
        createdBy: "system"
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("itemLedger")
      .values({
        entryType: "Positive Adjmt.",
        itemId: item.id,
        quantity: 1,
        locationId: location.id,
        trackedEntityId: entity.id,
        postingDate: "2026-01-01",
        companyId
      })
      .execute();
    return entity.id;
  };

  return { itemId: item.id, locationId: location.id, assetClass, unit };
}

const context = (f: Fixture) =>
  ServerFnContext.system({
    db: f.db,
    companyId: f.companyId,
    userId: "system"
  });

async function preview(f: Fixture, trackedEntityId: string) {
  const result = await previewAssetCapitalization(context(f), {
    trackedEntityId
  });
  if (result.error) throw result.error;
  return result.data.cost;
}

databaseTest(
  "the preview is the cost capitalize books, and consumes nothing",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 100);
      const serial = await c.unit("SN-1");
      const layer = await f.db
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Positive Adjmt.",
          costLedgerType: "Direct Cost",
          itemId: c.itemId,
          quantity: 1,
          cost: 60,
          remainingQuantity: 1,
          postingDate: "2026-01-01",
          trackedEntityId: serial,
          companyId: f.companyId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // The unit's own layer, not the item's unit cost.
      expect(await preview(f, serial)).toEqual(60);
      const untouched = await f.db
        .selectFrom("costLedger")
        .select("remainingQuantity")
        .where("id", "=", layer.id)
        .executeTakeFirstOrThrow();
      expect(Number(untouched.remainingQuantity)).toEqual(1);

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02"
      });
      if (posted.error) throw posted.error;
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toEqual(60);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a unit with no cost in inventory is refused, not capitalized at zero",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      const serial = await c.unit("SN-2");

      expect(await preview(f, serial)).toEqual(0);

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02"
      });
      expect(posted.error?.message).toMatch(/SN-2 has no cost in inventory/);

      // Rolled back: no asset, the unit still Available and in stock.
      const assets = await f.db
        .selectFrom("fixedAsset")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(assets).toHaveLength(0);
      const entity = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serial)
        .executeTakeFirstOrThrow();
      expect(entity.status).toEqual("Available");
    } finally {
      await f.cleanup();
    }
  }
);
