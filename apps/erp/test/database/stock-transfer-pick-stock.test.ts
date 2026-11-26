// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A stock transfer pick takes untracked stock out of its From bin. It wrote
// the negative row with no on-hand check, so a pick after the stock had moved
// took "no storage unit" (or an empty bin) below zero. The pick is refused
// when the From bin holds less common stock than the picks of that item and
// bin take together.

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
import {
  pickUntrackedStockTransferLines,
  postStockTransfer,
  StockTransferPickRefusal
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

describe.skipIf(!hasLocalDatabase)("stock transfer pick stock check", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-bin-a`;
    binB = `${f.prefix}-bin-b`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values([
          {
            id: binA,
            name: "Bin A",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: binB,
            name: "Bin B",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** An untracked item with `stock` on hand per bin (`null` = no storage unit). */
  async function itemWith(
    key: string,
    stock: Array<[string | null, number]>
  ): Promise<string> {
    const itemId = `${f.prefix}-item-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: `PART-${key}`,
          name: `Part ${key}`,
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      if (stock.length === 0) return;
      await trx
        .insertInto("itemLedger")
        .values(
          stock.map(([storageUnitId, quantity]) => ({
            itemId,
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
    return itemId;
  }

  /** A Released transfer with one line per `{ from, quantity }`, all to Bin B. */
  async function transferOf(
    key: string,
    itemId: string,
    lines: Array<{ from: string | null; quantity: number }>
  ) {
    const stockTransferId = `${f.prefix}-st-${key}`;
    const lineIds = lines.map((_, i) => `${f.prefix}-stl-${key}-${i}`);
    await seed(f, async (trx) => {
      await trx
        .insertInto("stockTransfer")
        .values({
          id: stockTransferId,
          stockTransferId: `ST-${key}`,
          locationId: f.locationId,
          status: "Released",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("stockTransferLine")
        .values(
          lines.map((line, i) => ({
            id: lineIds[i]!,
            stockTransferId,
            itemId,
            quantity: line.quantity,
            fromStorageUnitId: line.from,
            toStorageUnitId: binB,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return { stockTransferId, lineIds };
  }

  async function pick(
    transfer: { stockTransferId: string; lineIds: string[] },
    quantity: number
  ) {
    return invokePosting(
      handlesOf(f.ctx),
      "post-stock-transfer",
      {
        type: "inventory",
        stockTransferId: transfer.stockTransferId,
        stockTransferLineId: transfer.lineIds[0]!,
        quantity,
        locationId: f.locationId
      },
      postStockTransfer
    );
  }

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

  databaseTest("refuses a pick from a bin that holds none", async () => {
    // The stock moved to no storage unit after the line was made.
    const itemId = await itemWith("empty-bin", [[null, 5]]);
    const transfer = await transferOf("empty-bin", itemId, [
      { from: binA, quantity: 2 }
    ]);

    const result = await pick(transfer, 2);
    expect(result.error?.status).toBe(400);
    expect(result.error?.message).toMatch(/Only 0 of PART-empty-bin is in Bin A/);
    expect(await onHand(itemId)).toEqual({ none: 5 });
  });

  databaseTest(
    "refuses a pick from no storage unit when no storage unit holds none",
    async () => {
      const itemId = await itemWith("no-bin", [[binA, 5]]);
      const transfer = await transferOf("no-bin", itemId, [
        { from: null, quantity: 3 }
      ]);

      const result = await pick(transfer, 3);
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toMatch(
        /Only 0 of PART-no-bin is in no storage unit/
      );
      expect(await onHand(itemId)).toEqual({ [binA]: 5 });
    }
  );

  databaseTest("refuses a pick larger than what the bin holds", async () => {
    const itemId = await itemWith("short", [[binA, 2]]);
    const transfer = await transferOf("short", itemId, [
      { from: binA, quantity: 3 }
    ]);

    const result = await pick(transfer, 3);
    expect(result.error?.message).toMatch(/Only 2 of PART-short is in Bin A/);
    expect(await onHand(itemId)).toEqual({ [binA]: 2 });
  });

  databaseTest("moves a pick the From bin covers", async () => {
    const itemId = await itemWith("covered", [[binA, 5]]);
    const transfer = await transferOf("covered", itemId, [
      { from: binA, quantity: 3 }
    ]);

    unwrap(await pick(transfer, 3));
    expect(await onHand(itemId)).toEqual({ [binA]: 2, [binB]: 3 });
  });

  databaseTest(
    "Pick All refuses two lines of one item and bin that together exceed it",
    async () => {
      // Each line alone fits in the 5 the bin holds; together they take 6.
      const itemId = await itemWith("pick-all", [[binA, 5]]);
      const transfer = await transferOf("pick-all", itemId, [
        { from: binA, quantity: 3 },
        { from: binA, quantity: 3 }
      ]);

      const pickAll = pickUntrackedStockTransferLines(f.db, {
        stockTransferId: transfer.stockTransferId,
        companyId: f.companyId,
        userId: USER
      });
      await expect(pickAll).rejects.toBeInstanceOf(StockTransferPickRefusal);
      await expect(pickAll).rejects.toThrow(
        /Only 5 of PART-pick-all is in Bin A, and the pick needs 6/
      );
      expect(await onHand(itemId)).toEqual({ [binA]: 5 });
    }
  );

  databaseTest("Pick All moves lines the bins cover", async () => {
    const itemId = await itemWith("pick-all-ok", [
      [binA, 3],
      [null, 2]
    ]);
    const transfer = await transferOf("pick-all-ok", itemId, [
      { from: binA, quantity: 3 },
      { from: null, quantity: 2 }
    ]);

    const picked = await pickUntrackedStockTransferLines(f.db, {
      stockTransferId: transfer.stockTransferId,
      companyId: f.companyId,
      userId: USER
    });
    expect(picked).toHaveLength(2);
    expect(await onHand(itemId)).toEqual({ [binA]: 0, none: 0, [binB]: 5 });
  });
});
