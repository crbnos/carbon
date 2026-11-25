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
import { raceBehindRowLock } from "../fixtures/row-lock-race";
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

  const adjust = (
    input: Parameters<typeof postInventoryAdjustment>[1],
    db: Fixture["db"] = f.db
  ) =>
    invokePosting(
      handlesOf({ db, companyId: f.companyId, userId: USER }),
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
      .orderBy("createdAt")
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

  // An id that names nothing found no stock of it to move and answered
  // success with no ledger row.
  databaseTest(
    "refuses a move to another storage unit of a lot no entity has",
    async () => {
      const itemId = await item("move-unknown", "Batch");
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
        trackedEntityId: `${itemId}-unknown`,
        quantity: 6
      });

      expect(result.error?.message).toBe("Tracked entity not found");
      expect(await ledger(itemId)).toEqual([[id, 6]]);
    }
  );

  // The quantities page mints an id for an adjustment it does not open on a
  // row, so a decrease with an id that names nothing takes the lot by number.
  databaseTest(
    "takes a decrease with a new id from the lot of its number in the bin",
    async () => {
      const itemId = await item("decrease-minted", "Batch");
      const id = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        6
      );

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: `${itemId}-minted`,
        readableId: "LOT-1",
        quantity: 2
      });

      expect(result.error).toBeNull();
      expect(await ledger(itemId)).toEqual([
        [id, 6],
        [id, -2]
      ]);
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

  /** Scraps the whole lot from bin A, as the quantities page does. */
  async function scrapLot(itemId: string, lotId: string) {
    const result = await adjust({
      adjustmentType: "Scrap",
      itemId,
      locationId: f.locationId,
      storageUnitId: binA,
      trackedEntityId: lotId,
      scrapReasonId,
      quantity: 0
    });
    expect(result.error).toBeNull();
  }

  const statusOf = async (lotId: string) =>
    (
      await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", lotId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow()
    ).status;

  // The reversal booked the restored quantity against the payload's item,
  // and set the other item's lot Available.
  databaseTest("refuses an unscrap of another item's scrapped lot", async () => {
    const named = await item("unscrap-named", "Batch");
    const other = await item("unscrap-other", "Batch");
    const lotId = await lot(
      other,
      { locationId: f.locationId, storageUnitId: binA },
      4
    );
    await scrapLot(other, lotId);

    const result = await adjust({
      adjustmentType: "Unscrap",
      itemId: named,
      trackedEntityId: lotId,
      quantity: 0
    });

    expect(result.error?.message).toBe("The tracked entity is not of this item");
    expect(await ledger(named)).toEqual([]);
    expect(await ledger(other)).toEqual([
      [lotId, 4],
      [lotId, -4]
    ]);
    expect(await statusOf(lotId)).toBe("Scrapped");
  });

  databaseTest(
    "unscraps a lot with no location into the bin its scrap left",
    async () => {
      const itemId = await item("unscrap", "Batch");
      const lotId = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        4
      );
      await scrapLot(itemId, lotId);

      const result = await adjust({
        adjustmentType: "Unscrap",
        itemId,
        trackedEntityId: lotId,
        quantity: 0
      });

      expect(result.error).toBeNull();
      const restored = await f.db
        .selectFrom("itemLedger")
        .select(["locationId", "storageUnitId", "quantity"])
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .where("entryType", "=", "Positive Adjmt.")
        .where("documentType", "=", "Scrap")
        .execute();
      expect(
        restored.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([{ locationId: f.locationId, storageUnitId: binA, quantity: 4 }]);
      expect(await statusOf(lotId)).toBe("Available");
    }
  );

  databaseTest(
    "lets one of two concurrent unscraps of a lot restore it",
    async () => {
      const itemId = await item("unscrap-race", "Batch");
      const lotId = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        4
      );
      await scrapLot(itemId, lotId);

      const unscrap = (db: Fixture["db"]) =>
        adjust(
          {
            adjustmentType: "Unscrap",
            itemId,
            trackedEntityId: lotId,
            quantity: 0
          },
          db
        );
      const results = await raceBehindRowLock(
        { table: "trackedEntity", id: lotId },
        [unscrap, unscrap]
      );

      expect(
        results.map((result) => result.error?.message ?? null).sort()
      ).toEqual([null, "Only scrapped tracked entities can be unscrapped"].sort());
      expect(await ledger(itemId)).toEqual([
        [lotId, 4],
        [lotId, -4],
        [lotId, 4]
      ]);
    }
  );

  // A serial is one unit: the page caps what it sends, but the posting must
  // refuse a second unit of a serial that is already in stock.
  databaseTest(
    "refuses an increase that gives a serial in stock a second unit",
    async () => {
      const itemId = await item("serial-second", "Serial");
      const serialId = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        1
      );

      const positive = await adjust({
        adjustmentType: "Positive Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: serialId,
        quantity: 1
      });
      const setElsewhere = await adjust({
        adjustmentType: "Set Quantity",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: serialId,
        quantity: 1
      });

      expect([positive.error?.message, setElsewhere.error?.message]).toEqual([
        "Serial items can only have a quantity of 1",
        "Serial items can only have a quantity of 1"
      ]);
      expect(await ledger(itemId)).toEqual([[serialId, 1]]);
    }
  );

  databaseTest("drains a serial with a decrease", async () => {
    const itemId = await item("serial-drain", "Serial");
    const serialId = await lot(
      itemId,
      { locationId: f.locationId, storageUnitId: binA },
      1
    );

    const result = await adjust({
      adjustmentType: "Negative Adjmt.",
      itemId,
      locationId: f.locationId,
      storageUnitId: binA,
      trackedEntityId: serialId,
      quantity: 1
    });

    expect(result.error).toBeNull();
    expect(await ledger(itemId)).toEqual([
      [serialId, 1],
      [serialId, -1]
    ]);
    expect(await statusOf(serialId)).toBe("Consumed");
  });

  databaseTest("creates a new serial from one unit that names no id", async () => {
    const itemId = await item("serial-new", "Serial");

    const result = await adjust({
      adjustmentType: "Positive Adjmt.",
      itemId,
      locationId: f.locationId,
      storageUnitId: binA,
      readableId: "SN-NEW",
      quantity: 1
    });

    expect(result.error).toBeNull();
    const rows = await f.db
      .selectFrom("itemLedger as il")
      .innerJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
      .select(["il.quantity", "te.readableId", "te.quantity as unit"])
      .where("il.itemId", "=", itemId)
      .where("il.companyId", "=", f.companyId)
      .execute();
    expect(
      rows.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        unit: Number(row.unit)
      }))
    ).toEqual([{ quantity: 1, readableId: "SN-NEW", unit: 1 }]);
  });

  // Each increase alone leaves one unit; read before the other committed,
  // both pass and the serial ends with two.
  databaseTest(
    "lets one of two concurrent increases of a drained serial book its unit",
    async () => {
      const itemId = await item("serial-race", "Serial");
      const serialId = await lot(
        itemId,
        { locationId: f.locationId, storageUnitId: binA },
        1
      );
      const drained = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: serialId,
        quantity: 1
      });
      expect(drained.error).toBeNull();

      const increase = (db: Fixture["db"]) =>
        adjust(
          {
            adjustmentType: "Positive Adjmt.",
            itemId,
            locationId: f.locationId,
            storageUnitId: binA,
            trackedEntityId: serialId,
            quantity: 1
          },
          db
        );
      const results = await raceBehindRowLock(
        { table: "trackedEntity", id: serialId },
        [increase, increase]
      );

      expect(
        results.map((result) => result.error?.message ?? null).sort()
      ).toEqual([null, "Serial items can only have a quantity of 1"].sort());
      expect(await ledger(itemId)).toEqual([
        [serialId, 1],
        [serialId, -1],
        [serialId, 1]
      ]);
    }
  );
});
