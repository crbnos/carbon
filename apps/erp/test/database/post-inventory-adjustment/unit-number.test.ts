// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { postInventoryAdjustment as postInventoryAdjustmentBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import {
  backendPid,
  connectLocalTestDatabase,
  databaseTest,
  waitForLockWaits
} from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type Adjustment = Parameters<typeof postInventoryAdjustmentBody>[1];

// A batch item with one numbered unit, LOT-1, holding 5.
async function batchUnitFixture() {
  const f = await projectPostingFixture();
  const { itemId, locationId } = await f.addStockedItem("batch", {
    quantity: 1,
    unitCost: 10
  });
  await f.db
    .updateTable("item")
    .set({ itemTrackingType: "Batch" })
    .where("id", "=", itemId)
    .where("companyId", "=", f.companyId)
    .execute();
  const unitId = `${f.prefix}-lot-1`;
  const adjust = (
    input: Omit<Adjustment, "itemId" | "locationId" | "trackedEntityId">,
    db: Kysely<KyselyDatabase> = f.db
  ) =>
    invokePosting(
      handlesOf({ ...f.ctx, db }),
      "post-inventory-adjustment",
      { itemId, locationId, trackedEntityId: unitId, ...input },
      postInventoryAdjustmentBody
    );
  const created = await adjust({
    adjustmentType: "Positive Adjmt.",
    quantity: 5,
    readableId: "LOT-1"
  });
  expect(created.error).toBeNull();
  const unit = () =>
    f.db
      .selectFrom("trackedEntity")
      .select(["readableId", "quantity"])
      .where("id", "=", unitId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow()
      .then((row) => ({ ...row, quantity: Number(row.quantity) }));
  return { f, unitId, adjust, unit };
}

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof batchUnitFixture>>) => Promise<void>
) {
  let f: Fixture | undefined;
  try {
    const fixture = await batchUnitFixture();
    f = fixture.f;
    await run(fixture);
  } finally {
    await f?.cleanup();
  }
}

databaseTest("a stocked batch unit keeps its number", () =>
  withFixture(async ({ adjust, unit }) => {
    for (const blank of [
      { adjustmentType: "Set Quantity", quantity: 5, readableId: "" },
      { adjustmentType: "Negative Adjmt.", quantity: 1, readableId: "  " },
      { adjustmentType: "Positive Adjmt.", quantity: 1, readableId: "" }
    ] as const) {
      expect((await adjust(blank)).error).not.toBeNull();
    }
    expect(await unit()).toEqual({ readableId: "LOT-1", quantity: 5 });

    // Leaving the quantity as it is still renames the unit.
    const renamed = await adjust({
      adjustmentType: "Set Quantity",
      quantity: 5,
      readableId: "LOT-2"
    });
    expect(renamed.error).toBeNull();
    expect(await unit()).toEqual({ readableId: "LOT-2", quantity: 5 });
  })
);

// Runs `adjustment` on its own connection while another transaction has
// cleared the unit's number and not committed: the adjustment reads its
// quantities while the unit still has a number. Commits once the adjustment
// waits on the unit's lock.
async function whileNumberIsCleared<R>(
  f: Fixture,
  unitId: string,
  adjustment: (db: Kysely<KyselyDatabase>) => Promise<R>
): Promise<R> {
  const adjuster = await connectLocalTestDatabase();
  const holder = await connectLocalTestDatabase();
  let release = () => {};
  let held: Promise<void> = Promise.resolve();
  let adjusting: Promise<R> | undefined;
  try {
    await new Promise<void>((cleared, failed) => {
      held = holder.transaction().execute(async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId: null })
          .where("id", "=", unitId)
          .where("companyId", "=", f.companyId)
          .execute();
        cleared();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      held.catch(failed);
    });
    const adjusterPid = await backendPid(adjuster);
    adjusting = adjustment(adjuster);
    await waitForLockWaits(f.db, [adjusterPid]);
    release();
    await held;
    return await adjusting;
  } finally {
    // A failed wait still ends both transactions, so the connections close.
    release();
    await held.catch(() => {});
    await adjusting?.catch(() => {});
    await adjuster.destroy();
    await holder.destroy();
  }
}

databaseTest(
  "an increase reads the unit's number under its lock, not from the quantities read before it",
  () =>
    withFixture(async ({ f, unitId, adjust, unit }) => {
      const increase = await whileNumberIsCleared(f, unitId, (db) =>
        adjust({ adjustmentType: "Positive Adjmt.", quantity: 2 }, db)
      );
      expect(increase.error).not.toBeNull();
      expect(await unit()).toEqual({ readableId: null, quantity: 5 });
    })
);

databaseTest(
  "an unscrap reads the unit's number under its lock",
  () =>
    withFixture(async ({ f, unitId, adjust }) => {
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({
          name: "Damaged",
          companyId: f.companyId,
          createdBy: f.ctx.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const scrapped = await adjust({
        adjustmentType: "Scrap",
        quantity: 5,
        scrapReasonId: scrapReason.id
      });
      expect(scrapped.error).toBeNull();

      const unscrap = await whileNumberIsCleared(f, unitId, (db) =>
        adjust({ adjustmentType: "Unscrap", quantity: 5 }, db)
      );
      expect(unscrap.error).not.toBeNull();
      expect(
        await f.db
          .selectFrom("trackedEntity")
          .select(["readableId", "status"])
          .where("id", "=", unitId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).toEqual({ readableId: null, status: "Scrapped" });
    })
);
