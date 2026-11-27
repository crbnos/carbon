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
  seed
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import {
  type PlanningWeek,
  seedPlannedOrder,
  seedPlanningAction,
  seedPlanningWeeks
} from "./fixtures/planning";

let f: Fixture;
let week: PlanningWeek;
let removeWeeks: () => Promise<void>;

/** A Planned order with an Open Expedite on it, the item's only action. */
async function expediteOnPlannedOrder(
  itemId: string,
  orderType: "Make" | "Buy"
) {
  const plannedOrderId = await seedPlannedOrder(f, {
    key: itemId,
    week,
    itemId,
    orderType
  });
  await seedPlanningAction(f, {
    key: `expedite-${itemId}`,
    type: "Expedite",
    itemId,
    periodId: week.id,
    plannedOrderId,
    requiresManualAction: false,
    suggestedDate: "2295-01-02"
  });
}

async function gridIds(grid: "production" | "purchasing") {
  const fn = sql.raw(`get_${grid}_planning_grid`);
  const { rows } = await sql<{ id: string }>`
    SELECT "id" FROM ${fn}(
      ${f.companyId},
      ${f.locationId},
      ${[week.id]}::text[],
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
      const seeded = await seedPlanningWeeks(f, 1, "2295-01-01");
      [week] = seeded.weeks;
      removeWeeks = seeded.cleanup;
      // a reorder point gives each item a grid row with no demand
      await seed(f, (trx) =>
        trx
          .updateTable("itemPlanning")
          .set({
            reorderingPolicy: "Fixed Reorder Quantity",
            reorderPoint: 1,
            reorderQuantity: 1
          })
          .where("companyId", "=", f.companyId)
          .where("locationId", "=", f.locationId)
          .where("itemId", "in", [f.assemblyId, f.partId])
          .execute()
      );
    });

    afterEach(async () => {
      await removeWeeks();
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
