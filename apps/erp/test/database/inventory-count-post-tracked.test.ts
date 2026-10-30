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
  generateInventoryCountLines,
  postInventoryCount,
  recordInventoryCountUnit
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
