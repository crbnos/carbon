// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An adjustment lands on the lot and bin of the row it names. Batch numbers
// are not unique per lot, so a number never stands in for the lot it names.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { postInventoryAdjustment as postInventoryAdjustmentBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest, hasLocalDatabase } from "../fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("adjustment of a named lot", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let binC: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-bin-a`;
    binB = `${f.prefix}-bin-b`;
    binC = `${f.prefix}-bin-c`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values(
          [binA, binB, binC].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const adjust = (input: Parameters<typeof postInventoryAdjustmentBody>[1]) =>
    invokePosting(
      handlesOf(f.ctx),
      "post-inventory-adjustment",
      input,
      postInventoryAdjustmentBody
    );

  async function item(key: string, itemTrackingType: "Batch" | "Serial") {
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

  /** A lot of `itemId` numbered `readableId`, on hand in each `[bin, quantity]`. */
  async function lot(
    itemId: string,
    key: string,
    readableId: string,
    stock: [bin: string, quantity: number][]
  ) {
    const id = `${itemId}-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values({
          id,
          readableId,
          quantity: Math.max(
            0,
            stock.reduce((sum, [, quantity]) => sum + quantity, 0)
          ),
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
        .values(
          stock.map(([storageUnitId, quantity]) => ({
            itemId,
            trackedEntityId: id,
            quantity,
            locationId: f.locationId,
            storageUnitId,
            entryType: "Positive Adjmt." as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return id;
  }

  /** Every ledger row of the item as `[lot, bin, quantity]`, sorted. */
  async function ledger(itemId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["trackedEntityId", "storageUnitId", "quantity"])
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .execute();
    return rows
      .map((row) => [
        row.trackedEntityId,
        row.storageUnitId,
        Number(row.quantity)
      ])
      .sort();
  }

  /** The item's on-hand per bin, over every lot. */
  async function onHandByBin(itemId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", (eb) => eb.fn.sum<number>("quantity").as("q")])
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .groupBy("storageUnitId")
      .execute();
    return Object.fromEntries(
      rows.map((row) => [row.storageUnitId, Number(row.q)])
    );
  }

  async function entity(id: string) {
    const row = await f.db
      .selectFrom("trackedEntity")
      .select(["quantity", "status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return { quantity: Number(row.quantity), status: row.status };
  }

  /** Two lots numbered B-1: 55 in bin B, and 145 in bin A. */
  async function twoLotsOneBatchNumber(key: string) {
    const itemId = await item(key, "Batch");
    const first = await lot(itemId, "1", "B-1", [[binB, 55]]);
    const second = await lot(itemId, "2", "B-1", [[binA, 145]]);
    return { itemId, first, second };
  }

  // Each lot is reduced in turn: a lookup by batch number lands both
  // reductions on one lot, whichever it finds first.
  for (const [adjustmentType, quantities] of [
    ["Set Quantity", { first: 50, second: 90 }],
    ["Negative Adjmt.", { first: 5, second: 55 }]
  ] as const) {
    databaseTest(
      `${adjustmentType} below on-hand reduces the named lot, not another with its batch number`,
      async () => {
        const { itemId, first, second } = await twoLotsOneBatchNumber(
          adjustmentType === "Set Quantity" ? "set" : "negative"
        );

        for (const [trackedEntityId, storageUnitId, quantity] of [
          [second, binA, quantities.second],
          [first, binB, quantities.first]
        ] as const) {
          const result = await adjust({
            adjustmentType,
            itemId,
            locationId: f.locationId,
            storageUnitId,
            trackedEntityId,
            readableId: "B-1",
            quantity
          });
          expect(result.error).toBeNull();
        }

        expect(await ledger(itemId)).toEqual([
          [first, binB, -5],
          [first, binB, 55],
          [second, binA, -55],
          [second, binA, 145]
        ]);
        expect(await entity(first)).toEqual({
          quantity: 50,
          status: "Available"
        });
        expect(await entity(second)).toEqual({
          quantity: 90,
          status: "Available"
        });
      }
    );
  }

  databaseTest(
    "a lot in two bins is adjusted in the bin named, and settles on its total",
    async () => {
      const itemId = await item("two-bins", "Batch");
      const id = await lot(itemId, "1", "B-2", [
        [binA, 10],
        [binB, 5]
      ]);

      // More than bin B holds, though less than the lot holds in bin A.
      const refused = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: id,
        readableId: "B-2",
        quantity: 6
      });
      expect(refused.error?.message).toBe(
        "Insufficient quantity for negative adjustment"
      );
      expect(await ledger(itemId)).toHaveLength(2);

      // Bin B to zero: 5 - 5, not 10 - 0.
      const result = await adjust({
        adjustmentType: "Set Quantity",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: id,
        readableId: "B-2",
        quantity: 0
      });
      expect(result.error).toBeNull();
      expect(await ledger(itemId)).toEqual([
        [id, binA, 10],
        [id, binB, -5],
        [id, binB, 5]
      ]);
      expect(await entity(id)).toEqual({ quantity: 10, status: "Available" });

      // Bin B up to 8: the lot then holds 10 + 8.
      const raised = await adjust({
        adjustmentType: "Set Quantity",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: id,
        readableId: "B-2",
        quantity: 8
      });
      expect(raised.error).toBeNull();
      expect(await onHandByBin(itemId)).toEqual({ [binA]: 10, [binB]: 8 });
      expect(await entity(id)).toEqual({ quantity: 18, status: "Available" });
    }
  );

  databaseTest(
    "a reduction above what the named lot holds is refused",
    async () => {
      const { itemId, first, second } = await twoLotsOneBatchNumber("refused");

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: first,
        readableId: "B-1",
        quantity: 56
      });

      expect(result.error?.message).toBe(
        "Insufficient quantity for negative adjustment"
      );
      expect(await ledger(itemId)).toEqual([
        [first, binB, 55],
        [second, binA, 145]
      ]);
    }
  );

  // The form mints an id when no row is selected, so the number is the only
  // handle on the unit.
  databaseTest(
    "a serial is reduced by its number when no existing entity is named",
    async () => {
      const itemId = await item("serial", "Serial");
      const id = await lot(itemId, "1", "SN-1", [[binA, 1]]);

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        trackedEntityId: `${itemId}-minted`,
        readableId: "SN-1",
        quantity: 1
      });

      expect(result.error).toBeNull();
      expect(await ledger(itemId)).toEqual([
        [id, binA, -1],
        [id, binA, 1]
      ]);
      expect(await entity(id)).toEqual({ quantity: 0, status: "Consumed" });
    }
  );

  databaseTest(
    "a batch number that matches two lots in the bin is refused",
    async () => {
      const itemId = await item("ambiguous", "Batch");
      const first = await lot(itemId, "1", "B-3", [[binA, 20]]);
      const second = await lot(itemId, "2", "B-3", [[binA, 30]]);

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binA,
        readableId: "B-3",
        quantity: 5
      });

      expect(result.error?.message).toBe(
        "Multiple tracked entities in this storage unit — select a specific row to adjust"
      );
      expect(await ledger(itemId)).toEqual([
        [first, binA, 20],
        [second, binA, 30]
      ]);
    }
  );

  // With no row selected and no number typed, the only lot in the bin is the
  // target; its stock in another bin keeps it open.
  databaseTest(
    "the only lot in a bin, reduced without being named, settles on its total",
    async () => {
      const itemId = await item("bin-only", "Batch");
      const id = await lot(itemId, "1", "B-7", [
        [binA, 10],
        [binB, 5]
      ]);

      const result = await adjust({
        adjustmentType: "Negative Adjmt.",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: `${itemId}-minted`,
        quantity: 5
      });

      expect(result.error).toBeNull();
      expect(await ledger(itemId)).toEqual([
        [id, binA, 10],
        [id, binB, -5],
        [id, binB, 5]
      ]);
      expect(await entity(id)).toEqual({ quantity: 10, status: "Available" });
    }
  );

  // Each bin is emptied in turn: taking the first row found for the lot moves
  // one bin's quantity out of both.
  databaseTest(
    "a transfer moves what the lot holds in the bin it leaves",
    async () => {
      const itemId = await item("transfer", "Batch");
      const id = await lot(itemId, "1", "B-4", [
        [binA, 10],
        [binB, 5]
      ]);

      for (const originalStorageUnitId of [binB, binA]) {
        const result = await adjust({
          adjustmentType: "Set Quantity",
          itemId,
          locationId: f.locationId,
          storageUnitId: binC,
          originalStorageUnitId,
          trackedEntityId: id,
          readableId: "B-4",
          quantity: 0
        });
        expect(result.error).toBeNull();
      }

      expect(await onHandByBin(itemId)).toEqual({
        [binA]: 0,
        [binB]: 0,
        [binC]: 15
      });
      expect(await entity(id)).toEqual({ quantity: 15, status: "Available" });
    }
  );

  databaseTest("a scrap leaves the bin named", async () => {
    const itemId = await item("scrap", "Batch");
    const id = await lot(itemId, "1", "B-5", [
      [binA, 10],
      [binB, 5]
    ]);
    const scrapReason = await f.db
      .insertInto("scrapReason")
      .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const [storageUnitId, quantity] of [
      [binB, 2],
      [binA, 3]
    ] as const) {
      const result = await adjust({
        adjustmentType: "Scrap",
        itemId,
        locationId: f.locationId,
        storageUnitId,
        trackedEntityId: id,
        scrapReasonId: scrapReason.id,
        quantity
      });
      expect(result.error).toBeNull();
    }

    expect(await onHandByBin(itemId)).toEqual({ [binA]: 7, [binB]: 3 });
    expect(await entity(id)).toEqual({ quantity: 10, status: "Available" });
  });

  // The lot's total covers the scrap; the bin named does not. Booked on the
  // bin, a scrap of 8 left it at -2.
  databaseTest(
    "a scrap takes no more than the lot holds in the bin named",
    async () => {
      const itemId = await item("scrap-short", "Batch");
      const id = await lot(itemId, "1", "B-7", [
        [binA, 6],
        [binB, 4]
      ]);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Dropped", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      const scrap = (quantity: number) =>
        adjust({
          adjustmentType: "Scrap",
          itemId,
          locationId: f.locationId,
          storageUnitId: binA,
          trackedEntityId: id,
          scrapReasonId: scrapReason.id,
          quantity
        });

      // 8 of the lot, and the whole lot (quantity 0), are more than bin A holds.
      for (const quantity of [8, 0]) {
        const refused = await scrap(quantity);
        expect(refused.error?.status).toBe(400);
        expect(refused.error?.message).toBe(
          "The lot is in more than one storage unit: scrap a quantity from one, or move it first"
        );
      }
      expect(await onHandByBin(itemId)).toEqual({ [binA]: 6, [binB]: 4 });

      expect((await scrap(6)).error).toBeNull();
      expect(await onHandByBin(itemId)).toEqual({ [binA]: 0, [binB]: 4 });
      expect(await entity(id)).toEqual({ quantity: 4, status: "Available" });
    }
  );

  // A negative balance in one bin leaves the lot's total below zero, which a
  // tracked quantity cannot hold.
  databaseTest(
    "a lot with a negative balance in a bin is refused until that row is corrected",
    async () => {
      const itemId = await item("corrupt", "Batch");
      const id = await lot(itemId, "1", "B-6", [
        [binA, 55],
        [binB, -220]
      ]);
      const reduce = () =>
        adjust({
          adjustmentType: "Negative Adjmt.",
          itemId,
          locationId: f.locationId,
          storageUnitId: binA,
          trackedEntityId: id,
          readableId: "B-6",
          quantity: 10
        });

      const refused = await reduce();
      expect(refused.error?.status).toBe(400);
      expect(await onHandByBin(itemId)).toEqual({ [binA]: 55, [binB]: -220 });

      const corrected = await adjust({
        adjustmentType: "Set Quantity",
        itemId,
        locationId: f.locationId,
        storageUnitId: binB,
        trackedEntityId: id,
        readableId: "B-6",
        quantity: 0
      });
      expect(corrected.error).toBeNull();
      expect((await reduce()).error).toBeNull();

      expect(await onHandByBin(itemId)).toEqual({ [binA]: 45, [binB]: 0 });
      expect(await entity(id)).toEqual({ quantity: 45, status: "Available" });
    }
  );
});
