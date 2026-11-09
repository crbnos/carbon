// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Planning's Make / Order settles the Make / Order actions it answers by the
// QUANTITY ordered against them. MRP sums a week's orders into one action, so
// ordering part of a week (a row removed or lowered in the drawer, or one
// refused for starting in the past) used to settle the whole week and drop
// the rest of the need until the next MRP run. Now an action is Actioned only
// when what was ordered covers it; otherwise it keeps its status and drops to
// the remainder.

import { afterEach, beforeEach, describe, expect } from "vitest";
import { settleNewSupplyPlanningActions } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

type ActionType = "Order" | "Make";
type Status = "Open" | "Dismissed" | "Actioned";

let f: Fixture;
let week1: string;
let week2: string;

/** One new-supply action (no target order), Open in week 1 by default. */
async function action(
  overrides: {
    type?: ActionType;
    status?: Status;
    itemId?: string;
    locationId?: string;
    periodId?: string;
    planningSegmentId?: string;
    suggestedQuantity: number;
  },
  key: string
): Promise<string> {
  const id = `${f.prefix}-action-${key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("planningAction")
      .values({
        id,
        companyId: f.companyId,
        type: overrides.type ?? "Make",
        status: overrides.status ?? "Open",
        itemId: overrides.itemId ?? f.partId,
        locationId: overrides.locationId ?? f.locationId,
        periodId: overrides.periodId ?? week1,
        planningSegmentId: overrides.planningSegmentId ?? "",
        suggestedQuantity: overrides.suggestedQuantity,
        suggestedDate: f.today,
        horizonDate: f.today,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function read(id: string) {
  const row = await f.db
    .selectFrom("planningAction")
    .select(["status", "suggestedQuantity"])
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: row.status, quantity: Number(row.suggestedQuantity) };
}

function settle(
  ordered: {
    quantity: number;
    planningActionId?: string | null;
    itemId?: string;
    periodId?: string;
    planningSegmentId?: string;
  }[],
  type: ActionType = "Make"
) {
  return settleNewSupplyPlanningActions(f.db, {
    companyId: f.companyId,
    locationId: f.locationId,
    userId: USER,
    type,
    ordered: ordered.map((order) => ({
      itemId: order.itemId ?? f.partId,
      periodId: order.periodId ?? week1,
      planningSegmentId: order.planningSegmentId,
      quantity: order.quantity,
      planningActionId: order.planningActionId
    }))
  });
}

describe.skipIf(!hasLocalDatabase)("settleNewSupplyPlanningActions", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    week1 = `${f.prefix}-week-1`;
    week2 = `${f.prefix}-week-2`;
    // `period` has no company: these two are the test's own, removed after.
    await seed(f, (trx) =>
      trx
        .insertInto("period")
        .values([
          {
            id: week1,
            startDate: "2299-01-01",
            endDate: "2299-01-07",
            periodType: "Week"
          },
          {
            id: week2,
            startDate: "2299-01-08",
            endDate: "2299-01-14",
            periodType: "Week"
          }
        ])
        .execute()
    );
  });

  afterEach(async () => {
    // the actions go with the periods (ON DELETE CASCADE)
    await f.db.deleteFrom("period").where("id", "in", [week1, week2]).execute();
    await f.cleanup();
  });

  databaseTest("an order covering the action settles it", async () => {
    const id = await action({ suggestedQuantity: 100 }, "full");
    const result = await settle([{ quantity: 100, planningActionId: id }]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      expect.objectContaining({ id, status: "Actioned", suggestedQuantity: 100 })
    ]);
    expect(await read(id)).toEqual({ status: "Actioned", quantity: 100 });
  });

  databaseTest(
    "part of the action ordered keeps it open for the rest",
    async () => {
      const id = await action({ suggestedQuantity: 120 }, "part");
      const result = await settle([{ quantity: 50, planningActionId: id }]);
      expect(result.data).toEqual([
        expect.objectContaining({ id, status: "Open", suggestedQuantity: 70 })
      ]);
      expect(await read(id)).toEqual({ status: "Open", quantity: 70 });
    }
  );

  databaseTest(
    "the jobs an action splits into are summed against it",
    async () => {
      const id = await action({ suggestedQuantity: 120 }, "split");
      await settle([
        { quantity: 50, planningActionId: id },
        { quantity: 50, planningActionId: id }
      ]);
      expect(await read(id)).toEqual({ status: "Open", quantity: 20 });
      // ordering the last batch answers what is left
      await settle([{ quantity: 20, planningActionId: id }]);
      expect(await read(id)).toEqual({ status: "Actioned", quantity: 20 });
    }
  );

  databaseTest(
    "names the orders that answered each action, by their place in the list",
    async () => {
      const first = await action({ suggestedQuantity: 30 }, "first");
      const second = await action(
        { suggestedQuantity: 30, periodId: week2 },
        "second"
      );
      // a zero order is skipped without moving the other orders' places
      const result = await settle([
        { quantity: 0, planningActionId: first },
        { quantity: 10, planningActionId: second, periodId: week2 },
        { quantity: 10, planningActionId: first },
        { quantity: 5, periodId: week2 }
      ]);
      const byId = new Map(
        (result.data ?? []).map((row) => [row.id, row.orderIndexes])
      );
      expect(byId.get(first)).toEqual([2]);
      expect(byId.get(second)).toEqual([1, 3]);
      expect(await read(second)).toEqual({ status: "Open", quantity: 15 });
    }
  );

  databaseTest("ordering more than suggested settles the action", async () => {
    const id = await action({ suggestedQuantity: 40 }, "over");
    await settle([{ quantity: 55, planningActionId: id }]);
    expect(await read(id)).toEqual({ status: "Actioned", quantity: 40 });
  });

  databaseTest(
    "quantities are compared at 5 places, not as floats",
    async () => {
      const id = await action({ suggestedQuantity: 0.3 }, "float");
      await settle([
        { quantity: 0.1, planningActionId: id },
        { quantity: 0.2, planningActionId: id }
      ]);
      expect((await read(id)).status).toBe("Actioned");
    }
  );

  databaseTest(
    "an order moved to another week still settles the week it came from",
    async () => {
      const origin = await action({ suggestedQuantity: 30 }, "origin");
      const target = await action(
        { suggestedQuantity: 30, periodId: week2 },
        "target"
      );
      await settle([
        { quantity: 30, planningActionId: origin, periodId: week2 }
      ]);
      expect(await read(origin)).toEqual({ status: "Actioned", quantity: 30 });
      expect(await read(target)).toEqual({ status: "Open", quantity: 30 });
    }
  );

  databaseTest(
    "a row the planner added settles its week's action by quantity",
    async () => {
      const id = await action({ suggestedQuantity: 80 }, "manual");
      await settle([{ quantity: 30 }]);
      expect(await read(id)).toEqual({ status: "Open", quantity: 50 });
      await settle([{ quantity: 50 }]);
      expect(await read(id)).toEqual({ status: "Actioned", quantity: 50 });
    }
  );

  databaseTest(
    "a suggestion and an added row on one action are summed once",
    async () => {
      const id = await action({ suggestedQuantity: 100 }, "mixed");
      const result = await settle([
        { quantity: 60, planningActionId: id },
        { quantity: 40 }
      ]);
      expect(result.data).toHaveLength(1);
      expect(await read(id)).toEqual({ status: "Actioned", quantity: 100 });
    }
  );

  databaseTest(
    "an id MRP has since replaced settles nothing, not another action of its week",
    async () => {
      const id = await action({ suggestedQuantity: 60 }, "replaced");
      const result = await settle([
        { quantity: 25, planningActionId: `${f.prefix}-action-gone` }
      ]);
      expect(result.data).toEqual([]);
      expect(await read(id)).toEqual({ status: "Open", quantity: 60 });
    }
  );

  databaseTest(
    "another item's action id never settles it, nor its own week's action",
    async () => {
      const otherItems = await action(
        { suggestedQuantity: 10, itemId: f.assemblyId },
        "other-item"
      );
      const own = await action({ suggestedQuantity: 10 }, "own-item");
      await settle([{ quantity: 10, planningActionId: otherItems }]);
      expect(await read(otherItems)).toEqual({ status: "Open", quantity: 10 });
      expect(await read(own)).toEqual({ status: "Open", quantity: 10 });
    }
  );

  databaseTest(
    "a dismissed action ordered in part stays dismissed at the remainder",
    async () => {
      const id = await action(
        { suggestedQuantity: 90, status: "Dismissed" },
        "dismissed"
      );
      await settle([{ quantity: 40 }]);
      expect(await read(id)).toEqual({ status: "Dismissed", quantity: 50 });
      await settle([{ quantity: 50 }]);
      expect(await read(id)).toEqual({ status: "Actioned", quantity: 50 });
    }
  );

  databaseTest(
    "only the type, location and segment ordered are touched",
    async () => {
      const make = await action({ suggestedQuantity: 20 }, "make");
      const order = await action(
        { suggestedQuantity: 20, type: "Order" },
        "order"
      );
      const elsewhere = await action(
        { suggestedQuantity: 20, locationId: f.otherLocationId },
        "elsewhere"
      );
      const project = await action(
        { suggestedQuantity: 20, planningSegmentId: `${f.prefix}-project` },
        "project"
      );
      await settle([{ quantity: 20 }]);
      expect(await read(make)).toEqual({ status: "Actioned", quantity: 20 });
      expect(await read(order)).toEqual({ status: "Open", quantity: 20 });
      expect(await read(elsewhere)).toEqual({ status: "Open", quantity: 20 });
      expect(await read(project)).toEqual({ status: "Open", quantity: 20 });

      // the project's own order settles the project's action
      await settle([
        { quantity: 20, planningSegmentId: `${f.prefix}-project` }
      ]);
      expect(await read(project)).toEqual({ status: "Actioned", quantity: 20 });
    }
  );

  databaseTest(
    "an Order is settled in the units it is ordered in",
    async () => {
      // the caller converts purchase units to the action's inventory units
      const id = await action(
        { suggestedQuantity: 24, type: "Order" },
        "buy"
      );
      await settle([{ quantity: 2 * 6, planningActionId: id }], "Order");
      expect(await read(id)).toEqual({ status: "Open", quantity: 12 });
    }
  );

  databaseTest("an Actioned action is left as it is", async () => {
    const id = await action(
      { suggestedQuantity: 50, status: "Actioned" },
      "actioned"
    );
    const result = await settle([{ quantity: 10, planningActionId: id }]);
    expect(result.data).toEqual([]);
    expect(await read(id)).toEqual({ status: "Actioned", quantity: 50 });
  });

  databaseTest("nothing ordered changes nothing", async () => {
    const id = await action({ suggestedQuantity: 50 }, "none");
    expect((await settle([])).data).toEqual([]);
    expect((await settle([{ quantity: 0, planningActionId: id }])).data).toEqual(
      []
    );
    expect(await read(id)).toEqual({ status: "Open", quantity: 50 });
  });
});
