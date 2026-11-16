// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// The planning grids' Actions filter keeps a row whose only open action
// targets a planned order, when the planned order is of the grid's own type:
// Make on the production grid, Buy on the purchasing grid.

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

let f: Fixture;
let week: string;

/** A Planned order with an Open Expedite on it, the item's only action. */
async function expediteOnPlannedOrder(
  itemId: string,
  orderType: "Make" | "Buy"
) {
  const plannedOrderId = `${f.prefix}-planned-${itemId}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("plannedOrder")
      .values({
        id: plannedOrderId,
        companyId: f.companyId,
        itemId,
        locationId: f.locationId,
        planningSegmentId: "",
        orderType,
        status: "Planned",
        quantity: 10,
        dueDate: "2295-01-05",
        releaseDate: "2295-01-01",
        periodId: week,
        splitIndex: 0,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("planningAction")
      .values({
        companyId: f.companyId,
        type: "Expedite",
        status: "Open",
        itemId,
        locationId: f.locationId,
        periodId: week,
        planningSegmentId: "",
        plannedOrderId,
        requiresManualAction: false,
        suggestedQuantity: 10,
        suggestedDate: "2295-01-02",
        horizonDate: f.today,
        createdBy: USER
      })
      .execute();
  });
}

async function gridIds(grid: "production" | "purchasing") {
  const fn = sql.raw(`get_${grid}_planning_grid`);
  const { rows } = await sql<{ id: string }>`
    SELECT "id" FROM ${fn}(
      ${f.companyId},
      ${f.locationId},
      ${[week]}::text[],
      action_types => ${["Expedite"]}::text[]
    )
  `.execute(f.db);
  return rows.map((row) => row.id);
}

describe.skipIf(!hasLocalDatabase)(
  "the planning grids' Actions filter over planned orders",
  () => {
    beforeEach(async () => {
      f = await alwaysPostFixture();
      week = `${f.prefix}-week`;
      // `period` has no company: this one is the test's own, removed after.
      await seed(f, async (trx) => {
        await trx
          .insertInto("period")
          .values({
            id: week,
            startDate: "2295-01-01",
            endDate: "2295-01-07",
            periodType: "Week"
          })
          .execute();
        // a reorder point gives each item a grid row with no demand
        await trx
          .updateTable("itemPlanning")
          .set({
            reorderingPolicy: "Fixed Reorder Quantity",
            reorderPoint: 1,
            reorderQuantity: 1
          })
          .where("companyId", "=", f.companyId)
          .where("locationId", "=", f.locationId)
          .where("itemId", "in", [f.assemblyId, f.partId])
          .execute();
      });
    });

    afterEach(async () => {
      // the planned orders and their actions go with the period (ON DELETE CASCADE)
      await f.db.deleteFrom("period").where("id", "=", week).execute();
      await f.cleanup();
    });

    databaseTest(
      "keeps each row whose only action is on a planned order of the grid's type",
      async () => {
        await expediteOnPlannedOrder(f.assemblyId, "Make");
        await expediteOnPlannedOrder(f.partId, "Buy");

        expect(await gridIds("production")).toEqual([f.assemblyId]);
        expect(await gridIds("purchasing")).toEqual([f.partId]);
      }
    );

    // A Make item can still hold a Buy planned order (its replenishment
    // changed after a Firm order); that order's action is the purchasing
    // page's, not this row's.
    databaseTest(
      "does not keep a production row for an action on a Buy planned order",
      async () => {
        await expediteOnPlannedOrder(f.assemblyId, "Buy");

        expect(await gridIds("production")).toEqual([]);
      }
    );
  }
);
