// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// Scanning units into a Draft inventory count: each row of the spec's scan
// table (.ai/specs/2026-10-30-inventory-count-tracked-units.md).

import { expect } from "vitest";
import {
  generateInventoryCountLines,
  importInventoryCountRows,
  recordInventoryCountUnit,
  removeInventoryCountUnit
} from "../../app/modules/inventory/inventory.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { countUnits, draftCount } from "./fixtures/count-units";
import { databaseTest } from "./fixtures/local-database";

async function setup() {
  const f = await alwaysPostFixture();
  const units = await countUnits(f);
  const countId = await draftCount(f, "1", (args) =>
    generateInventoryCountLines(f.db, args)
  );
  const scan = (args: {
    storageUnitId: string | null;
    code: string;
    itemId?: string;
    quantity?: number;
  }) =>
    recordInventoryCountUnit(f.db, {
      inventoryCountId: countId,
      companyId: f.companyId,
      userId: USER,
      ...args
    });
  return { f, units, countId, scan };
}

async function lineOf(f: Fixture, lineId: string) {
  return f.db
    .selectFrom("inventoryCountLine")
    .select([
      "storageUnitId",
      "trackedEntityId",
      "readableId",
      "systemQuantity",
      "countedQuantity",
      "foundDuringCount"
    ])
    .where("id", "=", lineId)
    .executeTakeFirstOrThrow();
}

databaseTest("a serial expected in the bin is counted Found", async () => {
  const { f, units, scan } = await setup();
  try {
    const result = await scan({
      storageUnitId: units.binA,
      code: units.number("SN-1")
    });
    expect(result?.outcome).toBe("counted");
    if (result?.outcome !== "counted") return;
    expect(await lineOf(f, result.lineId)).toMatchObject({
      trackedEntityId: units.entity("SN-1"),
      countedQuantity: 1,
      foundDuringCount: false
    });
  } finally {
    await f.cleanup();
  }
});

databaseTest("scanning a counted serial again changes nothing", async () => {
  const { f, units, scan } = await setup();
  try {
    await scan({ storageUnitId: units.binA, code: units.number("SN-1") });
    const again = await scan({
      storageUnitId: units.binA,
      code: units.number("SN-1")
    });
    expect(again?.outcome).toBe("alreadyCounted");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a serial expected in another bin adds an Unexpected line in this bin",
  async () => {
    const { f, units, scan } = await setup();
    try {
      const result = await scan({
        storageUnitId: units.binA,
        code: units.number("SN-3")
      });
      expect(result?.outcome).toBe("added");
      if (result?.outcome !== "added") return;
      expect(await lineOf(f, result.lineId)).toMatchObject({
        storageUnitId: units.binA,
        trackedEntityId: units.entity("SN-3"),
        systemQuantity: 0,
        countedQuantity: 1,
        foundDuringCount: true
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a batch number asks for its quantity, then counts it", async () => {
  const { f, units, scan } = await setup();
  try {
    const first = await scan({
      storageUnitId: units.binA,
      code: units.number("LOT-1")
    });
    expect(first).toEqual({
      outcome: "needsQuantity",
      itemId: units.batchItemId
    });
    const second = await scan({
      storageUnitId: units.binA,
      code: units.number("LOT-1"),
      quantity: 7
    });
    expect(second?.outcome).toBe("counted");
    if (second?.outcome !== "counted") return;
    expect((await lineOf(f, second.lineId)).countedQuantity).toBe(7);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "an unknown number asks for the item, then adds a new unit",
  async () => {
    const { f, units, scan } = await setup();
    try {
      const code = units.number("SN-NEW");
      expect(await scan({ storageUnitId: units.binA, code })).toEqual({
        outcome: "unknown"
      });
      const added = await scan({
        storageUnitId: units.binA,
        code,
        itemId: units.serialItemId
      });
      expect(added?.outcome).toBe("added");
      if (added?.outcome !== "added") return;
      expect(await lineOf(f, added.lineId)).toMatchObject({
        trackedEntityId: null,
        readableId: code,
        countedQuantity: 1,
        foundDuringCount: true
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an item code of a serial item asks for the serial", async () => {
  const { f, units, scan } = await setup();
  try {
    expect(
      await scan({ storageUnitId: units.binA, code: `${f.prefix}-SER` })
    ).toEqual({ outcome: "needsUnitNumber", itemId: units.serialItemId });
  } finally {
    await f.cleanup();
  }
});

databaseTest("a storage unit of another location is refused", async () => {
  const { f, units, scan } = await setup();
  try {
    expect(
      await scan({ storageUnitId: "not-a-bin", code: units.number("SN-1") })
    ).toEqual({ outcome: "wrongStorageUnit" });
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "only an added line can be removed, and only on a Draft count",
  async () => {
    const { f, units, countId, scan } = await setup();
    try {
      const counted = await scan({
        storageUnitId: units.binA,
        code: units.number("SN-1")
      });
      const added = await scan({
        storageUnitId: units.binA,
        code: units.number("SN-3")
      });
      if (counted?.outcome !== "counted" || added?.outcome !== "added") {
        throw new Error("setup failed");
      }
      expect(
        await removeInventoryCountUnit(f.db, {
          lineId: counted.lineId,
          companyId: f.companyId
        })
      ).toBeUndefined();
      expect(
        await removeInventoryCountUnit(f.db, {
          lineId: added.lineId,
          companyId: f.companyId
        })
      ).toEqual({ id: added.lineId });

      await f.db
        .updateTable("inventoryCount")
        .set({ status: "Pending" })
        .where("id", "=", countId)
        .execute();
      expect(
        await scan({ storageUnitId: units.binA, code: units.number("SN-2") })
      ).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an import counts the units it lists and marks the rest of the bin Missing",
  async () => {
    const { f, units, countId } = await setup();
    try {
      const result = await importInventoryCountRows(f.db, {
        inventoryCountId: countId,
        companyId: f.companyId,
        userId: USER,
        rows: [
          {
            line: 2,
            item: `${f.prefix}-SER`,
            storageUnit: "A1",
            code: units.number("SN-1"),
            quantity: 1
          }
        ]
      });
      expect(result).toEqual({ counted: 2, added: 0, removed: 0 });
      const counted = await f.db
        .selectFrom("inventoryCountLine")
        .select(["trackedEntityId", "countedQuantity"])
        .where("inventoryCountId", "=", countId)
        .where("itemId", "=", units.serialItemId)
        .orderBy("trackedEntityId")
        .execute();
      expect(counted).toEqual([
        { trackedEntityId: units.entity("SN-1"), countedQuantity: 1 },
        { trackedEntityId: units.entity("SN-2"), countedQuantity: 0 },
        // SN-3 is in B2, which the file does not name.
        { trackedEntityId: units.entity("SN-3"), countedQuantity: null }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an import with an error writes nothing", async () => {
  const { f, units, countId } = await setup();
  try {
    const result = await importInventoryCountRows(f.db, {
      inventoryCountId: countId,
      companyId: f.companyId,
      userId: USER,
      rows: [
        {
          line: 2,
          item: `${f.prefix}-SER`,
          storageUnit: "A1",
          code: units.number("SN-1"),
          quantity: 1
        },
        {
          line: 3,
          item: `${f.prefix}-SER`,
          storageUnit: "Nowhere",
          code: units.number("SN-2"),
          quantity: 1
        }
      ]
    });
    expect(result).toEqual({
      errors: [
        { line: 3, message: 'Unknown storage unit "Nowhere" at this location' }
      ]
    });
    const anyCounted = await f.db
      .selectFrom("inventoryCountLine")
      .select("id")
      .where("inventoryCountId", "=", countId)
      .where("countedQuantity", "is not", null)
      .execute();
    expect(anyCounted).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
