// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An adjustment reads the lot's stock before its transaction, then locks the
// lot. A draw that commits in between (a maintenance or service issue, a
// pick) must count: the adjustment reads the lot again under the lock, so
// its check, the entity's quantity and the ledger agree.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { postInventoryAdjustment as postInventoryAdjustmentBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "../fixtures/always-post";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "../fixtures/local-database";

type Db = Kysely<KyselyDatabase>;
type Input = Parameters<typeof postInventoryAdjustmentBody>[1];

async function backendPid(db: Db) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

/** Waits until `waiter` waits on a lock `blocker` holds, or until the
 *  adjustment has finished: one that never takes the lot's lock does not
 *  wait, and finishes on what it read before the draw. */
async function waitUntilBlocked(
  monitor: Db,
  blocker: number,
  waiter: number,
  finished: () => boolean
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if (finished()) return;
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE pid = ${waiter} AND ${blocker} = ANY(pg_blocking_pids(pid))
      ) AS blocked
    `.execute(monitor);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The adjustment never waited on the lot's lock");
}

describe.skipIf(!hasLocalDatabase)("an adjustment during a draw", () => {
  let f: Fixture;
  let bin: string;
  let otherBin: string;
  let scrapReasonId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    bin = `${f.prefix}-bin`;
    otherBin = `${f.prefix}-other-bin`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values(
          [bin, otherBin].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );
    const scrapReason = await f.db
      .insertInto("scrapReason")
      .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
      .returning("id")
      .executeTakeFirstOrThrow();
    scrapReasonId = scrapReason.id;
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A batch item with one lot of 10 in the bin. */
  async function lotOfTen(key: string) {
    const itemId = `${f.prefix}-${key}`;
    const lotId = `${itemId}-lot`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: itemId,
          name: key,
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
      await trx
        .insertInto("trackedEntity")
        .values({
          id: lotId,
          readableId: `${key}-B1`,
          quantity: 10,
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
          trackedEntityId: lotId,
          quantity: 10,
          locationId: f.locationId,
          storageUnitId: bin,
          entryType: "Positive Adjmt.",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return { itemId, lotId };
  }

  /** Runs the adjustment while another connection draws 6 from the lot
   *  under its row lock, and commits the draw once the adjustment waits. */
  async function adjustDuringDraw(
    lot: { itemId: string; lotId: string },
    input: Input
  ) {
    const drawer = await connectLocalTestDatabase();
    const adjuster = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    let drawing: Promise<void> | undefined;
    let adjusting: Promise<unknown> | undefined;
    try {
      // Each pool has one connection, busy once its transaction starts.
      const drawerPid = await backendPid(drawer);
      const adjusterPid = await backendPid(adjuster);
      drawing = drawer.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM "trackedEntity" WHERE id = ${lot.lotId} FOR UPDATE`.execute(
          trx
        );
        await trx
          .insertInto("itemLedger")
          .values({
            itemId: lot.itemId,
            trackedEntityId: lot.lotId,
            quantity: -6,
            locationId: f.locationId,
            storageUnitId: bin,
            entryType: "Negative Adjmt.",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 4 })
          .where("id", "=", lot.lotId)
          .where("companyId", "=", f.companyId)
          .execute();
        held();
        await released;
      });
      void drawing.catch(() => {});
      await Promise.race([holding, drawing]);

      const adjustment = invokePosting(
        { db: adjuster, companyId: f.companyId, userId: USER },
        "post-inventory-adjustment",
        input,
        postInventoryAdjustmentBody
      );
      adjusting = adjustment;
      let finished = false;
      void adjustment.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        }
      );
      await waitUntilBlocked(monitor, drawerPid, adjusterPid, () => finished);
      release();
      await drawing;
      return await adjustment;
    } finally {
      release();
      await drawing?.catch(() => {});
      await adjusting?.catch(() => {});
      await drawer.destroy();
      await adjuster.destroy();
      await monitor.destroy();
    }
  }

  /** The lot's quantity and status, and its total on the ledger. */
  async function lotState(lotId: string) {
    const entity = await f.db
      .selectFrom("trackedEntity")
      .select(["quantity", "status"])
      .where("id", "=", lotId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const ledger = await f.db
      .selectFrom("itemLedger")
      .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
      .where("trackedEntityId", "=", lotId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    return {
      entity: Number(entity.quantity),
      status: entity.status,
      ledger: Number(ledger.quantity)
    };
  }

  /** The lot's on-hand per bin. */
  async function lotByBin(lotId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", (eb) => eb.fn.sum<number>("quantity").as("q")])
      .where("trackedEntityId", "=", lotId)
      .where("companyId", "=", f.companyId)
      .groupBy("storageUnitId")
      .execute();
    return Object.fromEntries(
      rows.map((row) => [row.storageUnitId, Number(row.q)])
    );
  }

  databaseTest(
    "an increase of a named lot settles the lot on the stock left by the draw",
    async () => {
      const lot = await lotOfTen("increase");
      const result = await adjustDuringDraw(lot, {
        adjustmentType: "Positive Adjmt.",
        itemId: lot.itemId,
        locationId: f.locationId,
        storageUnitId: bin,
        trackedEntityId: lot.lotId,
        quantity: 1
      });

      expect(result.error).toBeNull();
      // 10 − 6 drawn + 1.
      expect(await lotState(lot.lotId)).toEqual({
        entity: 5,
        status: "Available",
        ledger: 5
      });
    }
  );

  for (const [name, named] of [
    ["named by its id", true],
    ["found by its batch number", false]
  ] as const) {
    databaseTest(
      `a decrease of a lot ${name} is checked against the stock left by the draw`,
      async () => {
        const lot = await lotOfTen(named ? "decrease-id" : "decrease-number");
        const result = await adjustDuringDraw(lot, {
          adjustmentType: "Negative Adjmt.",
          itemId: lot.itemId,
          locationId: f.locationId,
          storageUnitId: bin,
          ...(named
            ? { trackedEntityId: lot.lotId }
            : { readableId: `decrease-number-B1` }),
          quantity: 5
        });

        // 5 is more than the 4 the draw left.
        expect(result.error?.status).toBe(400);
        expect(await lotState(lot.lotId)).toEqual({
          entity: 4,
          status: "Available",
          ledger: 4
        });
      }
    );
  }

  databaseTest(
    "a partial scrap of a lot leaves it what the draw and the scrap left",
    async () => {
      const lot = await lotOfTen("scrap");
      const result = await adjustDuringDraw(lot, {
        adjustmentType: "Scrap",
        itemId: lot.itemId,
        locationId: f.locationId,
        storageUnitId: bin,
        trackedEntityId: lot.lotId,
        scrapReasonId,
        quantity: 3
      });

      expect(result.error).toBeNull();
      // 10 − 6 drawn − 3 scrapped; the scrapped 3 left as a split child.
      expect(await lotState(lot.lotId)).toEqual({
        entity: 1,
        status: "Available",
        ledger: 1
      });
    }
  );

  databaseTest(
    "a move to another storage unit moves what the draw left in the bin",
    async () => {
      const lot = await lotOfTen("move");
      const result = await adjustDuringDraw(lot, {
        adjustmentType: "Set Quantity",
        itemId: lot.itemId,
        locationId: f.locationId,
        storageUnitId: otherBin,
        originalStorageUnitId: bin,
        trackedEntityId: lot.lotId,
        readableId: "move-B1",
        quantity: 0
      });

      expect(result.error).toBeNull();
      expect(await lotByBin(lot.lotId)).toEqual({ [bin]: 0, [otherBin]: 4 });
      expect(await lotState(lot.lotId)).toEqual({
        entity: 4,
        status: "Available",
        ledger: 4
      });
    }
  );
});
