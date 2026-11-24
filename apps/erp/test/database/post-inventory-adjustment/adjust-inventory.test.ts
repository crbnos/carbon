// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The adjustment operation takes what the quantities page sends, and an API or
// MCP caller reaches the operation, not the page. Runs against the local stack
// (SUPABASE_DB_URL and its PostgREST); skipped without one.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { adjustInventory } from "../../../app/modules/inventory/inventory.server";
import { postInventoryAdjustment } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest, hasLocalDatabase } from "../fixtures/local-database";
import { operationContext, postgrestTest } from "../fixtures/local-supabase";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../fixtures/project-posting";

// The page always names a serial or lot for a Serial or Batch item, a new id
// for new stock; a caller that sends only the number must not book stock with
// no lot on a tracked item.
postgrestTest(
  "an increase of a batch item with only a batch number starts a lot with that number",
  async (serviceRole) => {
    const f = await alwaysPostFixture();
    try {
      const itemId = `${f.prefix}-batch`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: itemId,
            name: "Batch part",
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
      });

      const result = await adjustInventory(
        operationContext(f, serviceRole, USER),
        {
          itemId,
          adjustmentType: "Positive Adjmt.",
          quantity: 5,
          locationId: f.locationId,
          readableId: "B-100"
        }
      );
      expect(result.error).toBeNull();

      const rows = await f.db
        .selectFrom("itemLedger as il")
        .leftJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
        .select(["il.quantity", "te.readableId", "te.status", "te.quantity as lot"])
        .where("il.itemId", "=", itemId)
        .where("il.companyId", "=", f.companyId)
        .execute();
      expect(
        rows.map((row) => ({
          quantity: Number(row.quantity),
          readableId: row.readableId,
          status: row.status,
          lot: Number(row.lot)
        }))
      ).toEqual([
        { quantity: 5, readableId: "B-100", status: "Available", lot: 5 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

// The page sends the row's stock owner; an operation input without the field
// dropped it, and the adjustment landed on common stock.
postgrestTest(
  "an adjustment sets the stock of the owner it names",
  async (serviceRole) => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      // 10 in common stock, 4 in the project's stock.
      const { itemId, locationId } = await f.addStockedItem("owned", {
        quantity: 10,
        unitCost: 10
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12
      });

      const result = await adjustInventory(
        operationContext(f, serviceRole, PROJECT_TEST_USER),
        {
          itemId,
          adjustmentType: "Set Quantity",
          quantity: 3,
          locationId,
          projectId: f.projectId
        }
      );
      expect(result.error).toBeNull();

      const stock = await f.db
        .selectFrom("itemStockQuantities")
        .select(["projectId", "quantityOnHand"])
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .orderBy("projectId")
        .execute();
      expect(
        stock.map((row) => [row.projectId, Number(row.quantityOnHand)])
      ).toEqual([
        ["", 10],
        [f.projectId, 3]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

// The posting reads the item, so the MES, which posts to it directly, and the
// operation are held to one rule: the stock of a Serial or Batch item is a
// serial or lot, and a serial or lot belongs to such an item.
describe.skipIf(!hasLocalDatabase)("an adjustment read against its item", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let scrapReasonId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-bin-a`;
    binB = `${f.prefix}-bin-b`;
    scrapReasonId = `${f.prefix}-damaged`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values(
          [binA, binB].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      await trx
        .insertInto("scrapReason")
        .values({
          id: scrapReasonId,
          name: "Damaged",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const adjust = (input: Parameters<typeof postInventoryAdjustment>[1]) =>
    invokePosting(
      handlesOf(f.ctx),
      "post-inventory-adjustment",
      input,
      postInventoryAdjustment
    );

  async function item(
    key: string,
    itemTrackingType: "Inventory" | "Batch" | "Serial"
  ) {
    const id = `${f.prefix}-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id,
          readableId: id,
          name: key,
          type: "Part",
          itemTrackingType,
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "=", id)
        .where("companyId", "=", f.companyId)
        .execute();
    });
    return id;
  }

  /** A lot of `itemId` with `quantity` on hand in `storageUnitId` at `locationId`. */
  async function lot(
    itemId: string,
    { locationId, storageUnitId }: { locationId: string; storageUnitId: string | null },
    quantity: number
  ) {
    const id = `${itemId}-lot`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values({
          id,
          readableId: "LOT-1",
          quantity,
          status: "Available",
          sourceDocument: "Item",
          sourceDocumentId: itemId,
          itemId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("itemLedger")
        .values({
          itemId,
          trackedEntityId: id,
          quantity,
          locationId,
          storageUnitId,
          entryType: "Positive Adjmt.",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return id;
  }

  /** The item's ledger rows as `[lot, quantity]`. */
  async function ledger(itemId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["trackedEntityId", "quantity"])
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .execute();
    return rows.map((row) => [row.trackedEntityId, Number(row.quantity)]);
  }

  databaseTest(
    "refuses a serial or lot on an item that is not Serial or Batch",
    async () => {
      const itemId = await item("untracked", "Inventory");

      const result = await adjust({
        adjustmentType: "Positive Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: `${itemId}-minted`,
        quantity: 5
      });

      expect(result.error?.message).toBe(
        "Only a Serial or Batch item has serials or lots: leave out trackedEntityId"
      );
      expect(await ledger(itemId)).toEqual([]);
    }
  );

  databaseTest(
    "refuses a lot that has no stock of the item at the location",
    async () => {
      const itemId = await item("elsewhere", "Batch");
      const id = await lot(
        itemId,
        { locationId: f.otherLocationId, storageUnitId: null },
        4
      );

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: id,
        quantity: 1
      });

      expect(result.error?.message).toBe(
        "The tracked entity has no stock of this item at this location"
      );
      expect(await ledger(itemId)).toEqual([[id, 4]]);
    }
  );

  databaseTest("refuses more than one unit of a serial item", async () => {
    const itemId = await item("serial", "Serial");

    const result = await adjust({
      adjustmentType: "Positive Adjmt.",
      itemId,
      locationId: f.locationId,
      storageUnitId: binA,
      readableId: "SN-1",
      quantity: 2
    });

    expect(result.error?.message).toBe(
      "Serial items can only have a quantity of 1"
    );
    expect(await ledger(itemId)).toEqual([]);
  });

  // Given a new id, a scrap failed on "Tracked entity not found" for an id
  // the caller never sent.
  databaseTest("refuses a scrap of a batch item that names no lot", async () => {
    const itemId = await item("scrap", "Batch");
    const id = await lot(
      itemId,
      { locationId: f.locationId, storageUnitId: binA },
      6
    );

    const result = await adjust({
      adjustmentType: "Scrap",
      itemId,
      locationId: f.locationId,
      storageUnitId: binA,
      scrapReasonId,
      quantity: 1
    });

    expect(result.error?.message).toBe(
      "Name the serial or lot to scrap: send trackedEntityId"
    );
    expect(await ledger(itemId)).toEqual([[id, 6]]);
  });

  // Given a new id, the move found no stock of that id to move and answered
  // success with no ledger row.
  databaseTest(
    "refuses a move of a batch item to another storage unit that names no lot",
    async () => {
      const itemId = await item("move", "Batch");
      const id = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        6
      );

      const result = await adjust({
        adjustmentType: "Set Quantity",
        itemId,
        locationId: f.locationId,
        originalStorageUnitId: binA,
        storageUnitId: binB,
        quantity: 6
      });

      expect(result.error?.message).toBe(
        "Name the serial or lot to move to another storage unit: send trackedEntityId"
      );
      expect(await ledger(itemId)).toEqual([[id, 6]]);
    }
  );

  // As the MES posts it: no serial or lot named.
  databaseTest(
    "books an increase of a batch item that names no lot as a new lot",
    async () => {
      const itemId = await item("mes", "Batch");

      const result = await adjust({
        adjustmentType: "Positive Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        quantity: 5
      });

      expect(result.error).toBeNull();
      const rows = await f.db
        .selectFrom("itemLedger as il")
        .leftJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
        .select(["il.quantity", "te.status", "te.quantity as lot"])
        .where("il.itemId", "=", itemId)
        .where("il.companyId", "=", f.companyId)
        .execute();
      expect(
        rows.map((row) => ({
          quantity: Number(row.quantity),
          status: row.status,
          lot: Number(row.lot)
        }))
      ).toEqual([{ quantity: 5, status: "Available", lot: 5 }]);
    }
  );
});
