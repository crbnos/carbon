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

databaseTest(
  "an increase reads the unit's number under its lock, not from the quantities read before it",
  () =>
    withFixture(async ({ f, unitId, adjust, unit }) => {
      const adjuster = await connectLocalTestDatabase();
      const holder = await connectLocalTestDatabase();
      try {
        // Another transaction has cleared the number and not yet committed,
        // so the increase reads its quantities while the unit still has one.
        let release = () => {};
        let held: Promise<void> = Promise.resolve();
        await new Promise<void>((cleared) => {
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
        });

        const increase = adjust(
          { adjustmentType: "Positive Adjmt.", quantity: 2 },
          adjuster
        );
        await waitForLockWaits(f.db, [await backendPid(adjuster)]);
        release();
        await held;

        expect((await increase).error).not.toBeNull();
        expect(await unit()).toEqual({ readableId: null, quantity: 5 });
      } finally {
        await adjuster.destroy();
        await holder.destroy();
      }
    })
);
