// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An adjustment reads the lot's stock before its transaction, then locks the
// lot. A draw that commits in between (a maintenance or service issue, a
// pick) must count: the adjustment reads the lot again under the lock, so
// its check, the entity's quantity and the ledger agree.

import type { KyselyTx } from "@carbon/database/client";
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
import { backendPid, waitUntilBlocked } from "../fixtures/row-lock-race";

type Input = Parameters<typeof postInventoryAdjustmentBody>[1];

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

  /** A draw of 6 from the lot of ten in the bin. */
  async function drawSix(
    trx: KyselyTx,
    lot: { itemId: string; lotId: string }
  ) {
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
  }

  /** Runs the adjustment while another connection writes the lot under its
   *  row lock (by default it draws 6 from it), and commits that write once
   *  the adjustment waits. */
  async function adjustDuringDraw(
    lot: { itemId: string; lotId: string },
    input: Input,
    write: (trx: KyselyTx) => Promise<unknown> = (trx) => drawSix(trx, lot)
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
        await write(trx);
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

  // The lookup by number reads before the lock, the rename commits in the
  // gap: the decrease wrote the old number back over the rename.
  databaseTest(
    "a decrease by a batch number renamed meanwhile is refused and keeps the new number",
    async () => {
      const lot = await lotOfTen("renamed");
      const result = await adjustDuringDraw(
        lot,
        {
          adjustmentType: "Negative Adjmt.",
          itemId: lot.itemId,
          locationId: f.locationId,
          storageUnitId: bin,
          readableId: "renamed-B1",
          quantity: 2
        },
        (trx) =>
          trx
            .updateTable("trackedEntity")
            .set({ readableId: "renamed-B2" })
            .where("id", "=", lot.lotId)
            .where("companyId", "=", f.companyId)
            .execute()
      );

      expect(result.error?.status).toBe(400);
      const entity = await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", lot.lotId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(entity.readableId).toBe("renamed-B2");
      expect(await lotState(lot.lotId)).toEqual({
        entity: 10,
        status: "Available",
        ledger: 10
      });
    }
  );

  // The hold check before the transaction reads the lot the caller names; a
  // decrease that finds the lot by its number named none, and drew it down.
  databaseTest(
    "a decrease that finds a lot held for inspection by its number is refused",
    async () => {
      const lot = await lotOfTen("held");
      const line = `${f.prefix}-held-line`;
      await seed(f, async (trx) => {
        const receipt = await trx
          .insertInto("receipt")
          .values({
            receiptId: `${f.prefix}-RE-held`,
            locationId: f.locationId,
            sourceDocument: "Purchase Order",
            status: "Posted",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("receiptLine")
          .values({
            id: line,
            receiptId: receipt.id,
            itemId: lot.itemId,
            locationId: f.locationId,
            storageUnitId: bin,
            orderQuantity: 10,
            receivedQuantity: 10,
            unitOfMeasure: "EA",
            unitPrice: 0,
            requiresInspection: true,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({
            status: "On Hold",
            attributes: JSON.stringify({ "Receipt Line": line })
          })
          .where("id", "=", lot.lotId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("inspection")
          .values({
            inspectionId: `${f.prefix}-INS-held`,
            itemId: lot.itemId,
            lotSize: 10,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 10,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: receipt.id,
            sourceDocumentLineId: line,
            storageUnitId: bin,
            status: "Pending",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const result = await invokePosting(
        { db: f.db, companyId: f.companyId, userId: USER },
        "post-inventory-adjustment",
        {
          adjustmentType: "Negative Adjmt.",
          itemId: lot.itemId,
          locationId: f.locationId,
          storageUnitId: bin,
          readableId: "held-B1",
          quantity: 2
        },
        postInventoryAdjustmentBody
      );

      expect(result.error?.message).toMatch(/held for inspection/);
      expect(await lotState(lot.lotId)).toEqual({
        entity: 10,
        status: "On Hold",
        ledger: 10
      });
    }
  );

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
