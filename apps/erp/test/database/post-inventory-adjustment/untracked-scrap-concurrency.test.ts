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

databaseTest("two untracked scraps of one item at once both post", async () => {
  const f = await projectPostingFixture();
  const left = await connectLocalTestDatabase();
  const right = await connectLocalTestDatabase();
  const holder = await connectLocalTestDatabase();
  let release = () => {};
  let held: Promise<void> = Promise.resolve();
  let scraps: Promise<unknown> | undefined;
  try {
    const { itemId, locationId } = await f.addStockedItem("scrapped", {
      quantity: 10,
      unitCost: 10
    });
    const scrapReason = await f.db
      .insertInto("scrapReason")
      .values({
        name: "Damaged",
        companyId: f.companyId,
        createdBy: f.ctx.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const scrap = (db: Kysely<KyselyDatabase>) =>
      invokePosting(
        handlesOf({ ...f.ctx, db }),
        "post-inventory-adjustment",
        {
          adjustmentType: "Scrap",
          itemId,
          locationId,
          quantity: 1,
          scrapReasonId: scrapReason.id
        },
        postInventoryAdjustmentBody
      );

    // Another adjustment of the item holds a share lock on it, so both scraps
    // reach the item lock before either can take it.
    await new Promise<void>((locked, failed) => {
      held = holder.transaction().execute(async (trx) => {
        await trx
          .selectFrom("item")
          .select("id")
          .where("id", "=", itemId)
          .forShare()
          .execute();
        locked();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      held.catch(failed);
    });

    const scrapPids = [await backendPid(left), await backendPid(right)];
    const posting = Promise.all([scrap(left), scrap(right)]);
    scraps = posting;
    await waitForLockWaits(f.db, scrapPids);
    release();
    await held;

    const results = await posting;
    expect(results.map((result) => result.error)).toEqual([null, null]);
    const onHand = await f.db
      .selectFrom("itemLedger")
      .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(Number(onHand.quantity)).toEqual(8);
  } finally {
    // A failed wait still ends every transaction, so the connections close.
    release();
    await held.catch(() => {});
    await scraps?.catch(() => {});
    await left.destroy();
    await right.destroy();
    await holder.destroy();
    await f.cleanup();
  }
});
