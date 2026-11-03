// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// Posting a count of tracked units: a unit counted in another bin moves, a
// unit Carbon did not know is created, a Consumed unit comes back, and the
// units quality owns or another location holds are refused
// (.ai/specs/2026-10-30-inventory-count-tracked-units.md, Post).

import { expect } from "vitest";
import {
  assignInventoryCountSerial,
  generateInventoryCountLines,
  postInventoryCount,
  recordInventoryCountUnit,
  setInventoryCountUnnumberedQuantity
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  newJournals,
  seed,
  USER
} from "./fixtures/always-post";
import { type CountUnits, countUnits, draftCount } from "./fixtures/count-units";
import { databaseTest } from "./fixtures/local-database";

async function setup(scope?: { storageUnitIds: string[] }) {
  const f = await alwaysPostFixture();
  const units = await countUnits(f);
  const countId = await draftCount(f, "1", (args) =>
    generateInventoryCountLines(f.db, { ...args, ...scope })
  );
  return { f, units, countId };
}

function scan(
  f: Fixture,
  countId: string,
  args: {
    storageUnitId: string | null;
    code: string;
    itemId?: string;
    quantity?: number;
  }
) {
  return recordInventoryCountUnit(f.db, {
    inventoryCountId: countId,
    companyId: f.companyId,
    userId: USER,
    ...args
  });
}

/** Counts every snapshot line of the entity in the bin. */
async function countLine(
  f: Fixture,
  countId: string,
  trackedEntityId: string,
  countedQuantity: number
) {
  await f.db
    .updateTable("inventoryCountLine")
    .set({ countedQuantity })
    .where("inventoryCountId", "=", countId)
    .where("trackedEntityId", "=", trackedEntityId)
    .where("foundDuringCount", "=", false)
    .execute();
}

async function post(f: Fixture, countId: string) {
  await f.db
    .updateTable("inventoryCount")
    .set({ status: "Pending" })
    .where("id", "=", countId)
    .execute();
  return invokePosting(
    f.service,
    "post-inventory-count",
    { inventoryCountId: countId },
    postInventoryCount
  );
}

async function countLedger(f: Fixture, countId: string, entityId: string) {
  return f.db
    .selectFrom("itemLedger")
    .select(["entryType", "storageUnitId", "quantity"])
    .where("documentId", "=", countId)
    .where("documentType", "=", "Inventory Count")
    .where("trackedEntityId", "=", entityId)
    .orderBy("quantity")
    .execute();
}

async function entity(f: Fixture, id: string) {
  return f.db
    .selectFrom("trackedEntity")
    .select(["status", "quantity", "readableId"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

/** Ships the serial's stock out of its bin (it is used up). */
async function consume(f: Fixture, units: CountUnits, key: string) {
  await seed(f, async (trx) => {
    await trx
      .insertInto("itemLedger")
      .values({
        postingDate: f.today,
        entryType: "Negative Adjmt.",
        itemId: units.serialItemId,
        locationId: f.locationId,
        storageUnitId: units.binB,
        trackedEntityId: units.entity(key),
        quantity: -1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("trackedEntity")
      .set({ status: "Consumed" })
      .where("id", "=", units.entity(key))
      .execute();
  });
}

databaseTest(
  "a serial counted Missing in one bin and found in another moves, with no journal",
  async () => {
    const { f, units, countId } = await setup();
    try {
      await countLine(f, countId, units.entity("SN-3"), 0);
      await scan(f, countId, {
        storageUnitId: units.binA,
        code: units.number("SN-3")
      });
      const journals = await newJournals(f, async () => {
        const result = await post(f, countId);
        if (result.error) throw result.error;
      });
      expect(journals).toEqual([]);
      expect(await countLedger(f, countId, units.entity("SN-3"))).toEqual([
        { entryType: "Transfer", storageUnitId: units.binB, quantity: -1 },
        { entryType: "Transfer", storageUnitId: units.binA, quantity: 1 }
      ]);
      expect(await entity(f, units.entity("SN-3"))).toMatchObject({
        status: "Available",
        quantity: 1
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial found in a bin the count does not cover moves from its bin",
  async () => {
    // The count covers bin A1 only, so SN-3 (in B2) has no line.
    const g = await alwaysPostFixture();
    try {
      const u = await countUnits(g);
      const id = await draftCount(g, "1", (args) =>
        generateInventoryCountLines(g.db, { ...args, storageUnitIds: [u.binA] })
      );
      await scan(g, id, { storageUnitId: u.binA, code: u.number("SN-3") });
      const result = await post(g, id);
      expect(result.error).toBeNull();
      expect(await countLedger(g, id, u.entity("SN-3"))).toEqual([
        { entryType: "Transfer", storageUnitId: u.binB, quantity: -1 },
        { entryType: "Transfer", storageUnitId: u.binA, quantity: 1 }
      ]);
    } finally {
      await g.cleanup();
    }
  }
);

databaseTest(
  "a Consumed serial found on the shelf comes back Available",
  async () => {
    const { f, units, countId } = await setup();
    try {
      await consume(f, units, "SN-3");
      await scan(f, countId, {
        storageUnitId: units.binA,
        code: units.number("SN-3")
      });
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect(await countLedger(f, countId, units.entity("SN-3"))).toEqual([
        {
          entryType: "Positive Adjmt.",
          storageUnitId: units.binA,
          quantity: 1
        }
      ]);
      expect(await entity(f, units.entity("SN-3"))).toMatchObject({
        status: "Available",
        quantity: 1
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Scrapped serial found while counting refuses the post", async () => {
  const { f, units, countId } = await setup();
  try {
    await f.db
      .updateTable("trackedEntity")
      .set({ status: "Scrapped" })
      .where("id", "=", units.entity("SN-3"))
      .execute();
    const added = await scan(f, countId, {
      storageUnitId: units.binA,
      code: units.number("SN-3")
    });
    if (added?.outcome !== "added") throw new Error("setup failed");
    const result = await post(f, countId);
    expect(result.error?.body?.invalidLineIds).toEqual([added.lineId]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a serial in stock at another location refuses the post",
  async () => {
    const g = await alwaysPostFixture();
    try {
      const u = await countUnits(g);
      // SN-3 leaves B2 for the other location.
      await seed(g, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values([
            {
              postingDate: g.today,
              entryType: "Transfer",
              itemId: u.serialItemId,
              locationId: g.locationId,
              storageUnitId: u.binB,
              trackedEntityId: u.entity("SN-3"),
              quantity: -1,
              companyId: g.companyId,
              createdBy: USER
            },
            {
              postingDate: g.today,
              entryType: "Transfer",
              itemId: u.serialItemId,
              locationId: g.otherLocationId,
              trackedEntityId: u.entity("SN-3"),
              quantity: 1,
              companyId: g.companyId,
              createdBy: USER
            }
          ])
          .execute();
      });
      const id = await draftCount(g, "1", (args) =>
        generateInventoryCountLines(g.db, args)
      );
      const added = await scan(g, id, {
        storageUnitId: u.binA,
        code: u.number("SN-3")
      });
      if (added?.outcome !== "added") throw new Error("setup failed");
      const result = await post(g, id);
      expect(result.error?.body?.invalidLineIds).toEqual([added.lineId]);
    } finally {
      await g.cleanup();
    }
  }
);

databaseTest("an unknown serial is created with its number", async () => {
  const { f, units, countId } = await setup();
  try {
    const code = units.number("SN-NEW");
    const added = await scan(f, countId, {
      storageUnitId: units.binA,
      code,
      itemId: units.serialItemId
    });
    if (added?.outcome !== "added") throw new Error("setup failed");
    const result = await post(f, countId);
    expect(result.error).toBeNull();
    const line = await f.db
      .selectFrom("inventoryCountLine")
      .select("trackedEntityId")
      .where("id", "=", added.lineId)
      .executeTakeFirstOrThrow();
    expect(line.trackedEntityId).not.toBeNull();
    expect(await entity(f, line.trackedEntityId as string)).toEqual({
      status: "Available",
      quantity: 1,
      readableId: code
    });
    expect(
      await countLedger(f, countId, line.trackedEntityId as string)
    ).toEqual([
      { entryType: "Positive Adjmt.", storageUnitId: units.binA, quantity: 1 }
    ]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a batch counted short in one bin and found in another moves the found part",
  async () => {
    const { f, units, countId } = await setup();
    try {
      await countLine(f, countId, units.entity("LOT-1"), 6);
      await scan(f, countId, {
        storageUnitId: units.binB,
        code: units.number("LOT-1"),
        quantity: 4
      });
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect(await countLedger(f, countId, units.entity("LOT-1"))).toEqual([
        { entryType: "Transfer", storageUnitId: units.binA, quantity: -4 },
        { entryType: "Transfer", storageUnitId: units.binB, quantity: 4 }
      ]);
      expect(await entity(f, units.entity("LOT-1"))).toMatchObject({
        quantity: 10
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a batch counted short in two bins posts both lines, and keeps its quantity equal to its ledger",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const units = await countUnits(f);
      const lot = units.entity("LOT-1");
      // 6 of the lot in bin A and 4 in bin B, so the count has a line in each.
      await seed(f, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values(
            [
              { storageUnitId: units.binA, quantity: -4 },
              { storageUnitId: units.binB, quantity: 4 }
            ].map((row) => ({
              ...row,
              postingDate: f.today,
              entryType: "Transfer" as const,
              itemId: units.batchItemId,
              locationId: f.locationId,
              trackedEntityId: lot,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      const countId = await draftCount(f, "1", (args) =>
        generateInventoryCountLines(f.db, args)
      );
      for (const [storageUnitId, countedQuantity] of [
        [units.binA, 5],
        [units.binB, 3]
      ] as const) {
        await f.db
          .updateTable("inventoryCountLine")
          .set({ countedQuantity })
          .where("inventoryCountId", "=", countId)
          .where("trackedEntityId", "=", lot)
          .where("storageUnitId", "=", storageUnitId)
          .execute();
      }

      const result = await post(f, countId);
      expect(result.error).toBeNull();
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
        .where("trackedEntityId", "=", lot)
        .executeTakeFirstOrThrow();
      expect(Number(ledger.quantity)).toBe(8);
      expect(await countLedger(f, countId, lot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ storageUnitId: units.binA, quantity: -1 }),
          expect.objectContaining({ storageUnitId: units.binB, quantity: -1 })
        ])
      );
      expect(await entity(f, lot)).toMatchObject({
        quantity: 8,
        status: "Available"
      });
    } finally {
      await f.cleanup();
    }
  }
);

/** 5 serial units with no serial number in bin B2, oldest first. */
async function unnumberedUnits(f: Fixture, units: CountUnits) {
  const ids = [1, 2, 3, 4, 5].map((n) => `${f.prefix}-nonum-${n}`);
  await seed(f, async (trx) => {
    await trx
      .insertInto("trackedEntity")
      .values(
        ids.map((id, index) => ({
          id,
          readableId: null,
          itemId: units.serialItemId,
          quantity: 1,
          status: "Available" as const,
          sourceDocument: "Item",
          sourceDocumentId: units.serialItemId,
          createdAt: `2026-01-0${index + 1}T00:00:00Z`,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("itemLedger")
      .values(
        ids.map((id) => ({
          postingDate: f.today,
          entryType: "Positive Adjmt." as const,
          itemId: units.serialItemId,
          locationId: f.locationId,
          storageUnitId: units.binB,
          trackedEntityId: id,
          quantity: 1,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return ids;
}

async function setupUnnumbered() {
  const f = await alwaysPostFixture();
  const units = await countUnits(f);
  const ids = await unnumberedUnits(f, units);
  const countId = await draftCount(f, "1", (args) =>
    generateInventoryCountLines(f.db, args)
  );
  const setQuantity = (quantity: number) =>
    setInventoryCountUnnumberedQuantity(f.db, {
      inventoryCountId: countId,
      companyId: f.companyId,
      userId: USER,
      itemId: units.serialItemId,
      storageUnitId: units.binB,
      quantity
    });
  return { f, units, ids, countId, setQuantity };
}

databaseTest(
  "units with no serial number count oldest first, and the rest are written off",
  async () => {
    const { f, ids, countId, setQuantity } = await setupUnnumbered();
    try {
      expect(await setQuantity(3)).toEqual({ counted: 3 });
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      const statuses = await Promise.all(ids.map((id) => entity(f, id)));
      expect(statuses.map((e) => e.status)).toEqual([
        "Available",
        "Available",
        "Available",
        "Consumed",
        "Consumed"
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "counting more units with no serial number than expected is refused",
  async () => {
    const { f, setQuantity } = await setupUnnumbered();
    try {
      expect(await setQuantity(6)).toEqual({ tooMany: 5 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial number given while counting lands on the unit at post",
  async () => {
    const { f, units, ids, countId, setQuantity } = await setupUnnumbered();
    try {
      await setQuantity(5);
      const line = await f.db
        .selectFrom("inventoryCountLine")
        .select("id")
        .where("inventoryCountId", "=", countId)
        .where("trackedEntityId", "=", ids[0])
        .executeTakeFirstOrThrow();
      const assign = (readableId: string) =>
        assignInventoryCountSerial(f.db, {
          lineId: line.id,
          companyId: f.companyId,
          userId: USER,
          readableId
        });
      // A number another unit of the item holds is refused.
      expect(await assign(units.number("SN-1"))).toEqual({
        refusal: "numberTaken"
      });
      const number = units.number("SN-100");
      expect(await assign(number)).toEqual({ lineId: line.id });
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect((await entity(f, ids[0])).readableId).toBe(number);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "stock of a serial item with no unit record is counted as a quantity",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const units = await countUnits(f);
      // 4 units booked with no tracked entity.
      await seed(f, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values({
            postingDate: f.today,
            entryType: "Positive Adjmt.",
            itemId: units.serialItemId,
            locationId: f.locationId,
            storageUnitId: units.binB,
            quantity: 4,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const countId = await draftCount(f, "1", (args) =>
        generateInventoryCountLines(f.db, args)
      );
      await f.db
        .updateTable("inventoryCountLine")
        .set({ countedQuantity: 3 })
        .where("inventoryCountId", "=", countId)
        .where("itemId", "=", units.serialItemId)
        .where("trackedEntityId", "is", null)
        .execute();
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["entryType", "quantity"])
        .where("documentId", "=", countId)
        .where("trackedEntityId", "is", null)
        .execute();
      expect(ledger).toEqual([{ entryType: "Negative Adjmt.", quantity: -1 }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a batch whose own quantity drifted below its ledger posts and takes the ledger total",
  async () => {
    const { f, units, countId } = await setup();
    try {
      // The ledger holds 10 of LOT-1 in A1; the unit says 0. Nothing moved.
      await seed(f, (trx) =>
        trx
          .updateTable("trackedEntity")
          .set({ quantity: 0 })
          .where("id", "=", units.entity("LOT-1"))
          .execute()
      );
      await countLine(f, countId, units.entity("LOT-1"), 4);
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect(await entity(f, units.entity("LOT-1"))).toMatchObject({
        quantity: 4,
        status: "Available"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a count below what the ledger still holds after a movement is refused on its line",
  async () => {
    const { f, units, countId } = await setup();
    try {
      // After the snapshot, 8 of the 10 are used: unit and ledger both drop.
      await seed(f, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values({
            postingDate: f.today,
            entryType: "Negative Adjmt.",
            itemId: units.batchItemId,
            locationId: f.locationId,
            storageUnitId: units.binA,
            trackedEntityId: units.entity("LOT-1"),
            quantity: -8,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 2 })
          .where("id", "=", units.entity("LOT-1"))
          .execute();
      });
      await countLine(f, countId, units.entity("LOT-1"), 0);
      const result = await post(f, countId);
      const line = await f.db
        .selectFrom("inventoryCountLine")
        .select("id")
        .where("inventoryCountId", "=", countId)
        .where("trackedEntityId", "=", units.entity("LOT-1"))
        .executeTakeFirstOrThrow();
      expect(result.error?.body?.invalidLineIds).toEqual([line.id]);
    } finally {
      await f.cleanup();
    }
  }
);

/** A Non-Inventory item with 22 in the ledger from when it was stocked. */
async function nonInventoryItem(f: Fixture) {
  const itemId = `${f.prefix}-non`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${f.prefix}-NON`,
        name: "Fixings kit",
        type: "Part",
        itemTrackingType: "Non-Inventory",
        replenishmentSystem: "Buy",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("itemLedger")
      .values({
        postingDate: f.today,
        entryType: "Positive Adjmt.",
        itemId,
        locationId: f.locationId,
        quantity: 22,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return itemId;
}

databaseTest(
  "a Non-Inventory item with ledger history is left out of the snapshot",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const itemId = await nonInventoryItem(f);
      const countId = await draftCount(f, "non", (args) =>
        generateInventoryCountLines(f.db, args)
      );
      const lines = await f.db
        .selectFrom("inventoryCountLine")
        .select("id")
        .where("inventoryCountId", "=", countId)
        .where("itemId", "=", itemId)
        .execute();
      expect(lines).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting books nothing for a Non-Inventory line an older count holds",
  async () => {
    const { f, countId } = await setup();
    try {
      const itemId = await nonInventoryItem(f);
      await seed(f, (trx) =>
        trx
          .insertInto("inventoryCountLine")
          .values({
            inventoryCountId: countId,
            companyId: f.companyId,
            itemId,
            locationId: f.locationId,
            systemQuantity: 22,
            countedQuantity: 55,
            createdBy: USER
          })
          .execute()
      );
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      const booked = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("documentId", "=", countId)
        .where("itemId", "=", itemId)
        .execute();
      expect(booked).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

/** Writes a ledger row for a serial in bin B and marks it Consumed. */
async function breakSerial(
  f: Fixture,
  units: CountUnits,
  key: string,
  quantities: number[]
) {
  await seed(f, async (trx) => {
    if (quantities.length > 0) await trx
      .insertInto("itemLedger")
      .values(
        quantities.map((quantity) => ({
          postingDate: f.today,
          entryType: (quantity < 0 ? "Consumption" : "Positive Adjmt.") as
            | "Consumption"
            | "Positive Adjmt.",
          itemId: units.serialItemId,
          locationId: f.locationId,
          storageUnitId: units.binB,
          trackedEntityId: units.entity(key),
          quantity,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .updateTable("trackedEntity")
      .set({ status: "Consumed", quantity: 0 })
      .where("id", "=", units.entity(key))
      .execute();
  });
}

async function binOnHand(f: Fixture, units: CountUnits) {
  const row = await f.db
    .selectFrom("itemLedger")
    .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
    .where("itemId", "=", units.serialItemId)
    .where("storageUnitId", "=", units.binB)
    .executeTakeFirstOrThrow();
  return Number(row.quantity ?? 0);
}

databaseTest(
  "a Consumed serial issued twice is listed at -1 and a count of 0 brings on-hand to 0",
  async () => {
    const f = await alwaysPostFixture();
    const units = await countUnits(f);
    try {
      // SN-3 (1 in B2) is issued to a job twice: the ledger says -1.
      await breakSerial(f, units, "SN-3", [-1, -1]);
      const countId = await draftCount(f, "twice", (args) =>
        generateInventoryCountLines(f.db, args)
      );
      const line = await f.db
        .selectFrom("inventoryCountLine")
        .select("systemQuantity")
        .where("inventoryCountId", "=", countId)
        .where("trackedEntityId", "=", units.entity("SN-3"))
        .executeTakeFirstOrThrow();
      expect(Number(line.systemQuantity)).toBe(-1);

      await countLine(f, countId, units.entity("SN-3"), 0);
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect(await binOnHand(f, units)).toBe(0);
      expect(await entity(f, units.entity("SN-3"))).toMatchObject({
        quantity: 0,
        status: "Consumed"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial marked Consumed with stock left is listed, and a count of 0 clears it",
  async () => {
    const f = await alwaysPostFixture();
    const units = await countUnits(f);
    try {
      // SN-3 is marked Consumed but its +1 was never taken out.
      await breakSerial(f, units, "SN-3", []);
      const countId = await draftCount(f, "left", (args) =>
        generateInventoryCountLines(f.db, args)
      );
      await countLine(f, countId, units.entity("SN-3"), 0);
      const result = await post(f, countId);
      expect(result.error).toBeNull();
      expect(await binOnHand(f, units)).toBe(0);
      expect(await entity(f, units.entity("SN-3"))).toMatchObject({
        quantity: 0,
        status: "Consumed"
      });
    } finally {
      await f.cleanup();
    }
  }
);
