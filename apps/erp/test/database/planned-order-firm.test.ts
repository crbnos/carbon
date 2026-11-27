// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A person firms, unfirms and edits a planned order; Apply on a change action
// that targets a planned order edits (and firms) or deletes it. A Converted
// planned order is the history of its job or PO line and never changes.

import {
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { pageClaims } from "../page-claims";
import {
  applyPlannedOrderTargets,
  runMRP
} from "../../app/modules/production/production.service";
import {
  applyPlanningActions,
  dismissProductionPlanningActions,
  firmPlannedOrder,
  reopenProductionPlanningActions,
  unfirmPlannedOrder,
  updatePlannedOrder
} from "../../app/modules/production/production.server";
import {
  applyPlanningActions as applyPurchasingPlanningActions,
  dismissPurchasingPlanningActions
} from "../../app/modules/purchasing/purchasing.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { systemServiceOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import {
  type PlanningWeek,
  seedJob,
  seedPlannedOrder,
  seedPlanningAction,
  seedPlanningWeeks,
  seedScrapRate
} from "./fixtures/planning";

let f: Fixture;
// The system with no Supabase client: the MRP run a change starts fails at
// its first read, and the change must stand.
let service: ServiceContext;
let week: PlanningWeek;
let nextWeek: PlanningWeek;
let removeWeeks: () => Promise<void>;

function plannedOrder(
  key: string,
  overrides: Omit<Parameters<typeof seedPlannedOrder>[1], "key" | "week"> = {}
) {
  return seedPlannedOrder(f, { key, week, ...overrides });
}

function changeAction(
  type: "Expedite" | "Defer" | "Increase" | "Decrease" | "Cancel",
  plannedOrderId: string,
  suggested: { date?: string; quantity?: number } = {}
) {
  return seedPlanningAction(f, {
    key: `${type}-${plannedOrderId}`,
    type,
    periodId: week.id,
    plannedOrderId,
    requiresManualAction: false,
    suggestedQuantity: suggested.quantity ?? 10,
    suggestedDate: suggested.date ?? "2297-01-05"
  });
}

async function read(id: string, fixture: Fixture = f) {
  const row = await fixture.db
    .selectFrom("plannedOrder")
    .select([
      "status",
      "quantity",
      "scrapQuantity",
      "dueDate",
      "releaseDate",
      "splitIndex",
      "firmedBy",
      "firmedAt",
      "periodId"
    ])
    .where("id", "=", id)
    .where("companyId", "=", fixture.companyId)
    .executeTakeFirst();
  return (
    row && {
      ...row,
      quantity: Number(row.quantity),
      scrapQuantity: Number(row.scrapQuantity)
    }
  );
}

async function actionStatus(id: string, fixture: Fixture = f) {
  const row = await fixture.db
    .selectFrom("planningAction")
    .select("status")
    .where("id", "=", id)
    .where("companyId", "=", fixture.companyId)
    .executeTakeFirst();
  return row?.status ?? null;
}

describe.skipIf(!hasLocalDatabase)("planned order firm, edit and apply", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    service = systemServiceOf(
      { db: f.db, companyId: f.companyId, userId: USER },
      f.service.company.groupId
    );
    const seeded = await seedPlanningWeeks(f, 2, "2297-01-01");
    [week, nextWeek] = seeded.weeks;
    removeWeeks = seeded.cleanup;
  });

  afterEach(async () => {
    await removeWeeks();
    await f.cleanup();
  });

  databaseTest(
    "firm stamps the person, and unfirm gives the order back to MRP",
    async () => {
      const id = await plannedOrder("firm");

      const firmed = await firmPlannedOrder(service, {
        id,
        locationId: f.locationId
      });
      expect(firmed.error).toBeNull();
      const afterFirm = await read(id);
      expect(afterFirm).toMatchObject({ status: "Firm", firmedBy: USER });
      expect(afterFirm?.firmedAt).not.toBeNull();

      const unfirmed = await unfirmPlannedOrder(service, {
        id,
        locationId: f.locationId
      });
      expect(unfirmed.error).toBeNull();
      expect(await read(id)).toMatchObject({
        status: "Planned",
        firmedBy: null,
        firmedAt: null,
        splitIndex: 0
      });
    }
  );

  databaseTest(
    "unfirm moves the order to a free split index when MRP planned the same week meanwhile",
    async () => {
      const firm = await plannedOrder("held", { status: "Firm" });
      // MRP's own order for the same week and split index, planned while the
      // first one was Firm
      await plannedOrder("mrp");

      const unfirmed = await unfirmPlannedOrder(service, {
        id: firm,
        locationId: f.locationId
      });
      expect(unfirmed.error).toBeNull();
      expect(await read(firm)).toMatchObject({
        status: "Planned",
        splitIndex: 1
      });
    }
  );

  databaseTest(
    "an edit firms the order, restates a Make order's scrap and moves the release date with the due date",
    async () => {
      await seedScrapRate(f, f.partId, 0.15);
      const id = await plannedOrder("edit");
      const buy = await plannedOrder("edit-buy", { orderType: "Buy" });

      const result = await updatePlannedOrder(service, {
        id,
        locationId: f.locationId,
        quantity: 12,
        dueDate: "2297-01-12"
      });
      expect(result.error).toBeNull();
      expect(await read(id)).toMatchObject({
        status: "Firm",
        firmedBy: USER,
        quantity: 12,
        // 12 at 15 % = 1.8, rounded up
        scrapQuantity: 2,
        dueDate: "2297-01-12",
        // 2297-01-01 moved by the same 7 days
        releaseDate: "2297-01-08"
      });

      // a Buy order of the same item carries no scrap
      const bought = await updatePlannedOrder(service, {
        id: buy,
        locationId: f.locationId,
        quantity: 12
      });
      expect(bought.error).toBeNull();
      expect(await read(buy)).toMatchObject({ quantity: 12, scrapQuantity: 0 });
    }
  );

  databaseTest(
    "another company's planned order is not found by firm, unfirm, edit or Apply, and is left as it is",
    async () => {
      const other = await alwaysPostFixture();
      try {
        const foreign = await seedPlannedOrder(other, {
          key: "foreign",
          week,
          status: "Firm"
        });
        const foreignAction = await seedPlanningAction(other, {
          key: "foreign-increase",
          type: "Increase",
          periodId: week.id,
          plannedOrderId: foreign,
          suggestedQuantity: 15
        });
        // the other company's own location: the read fails before the
        // location check
        const elsewhere = { id: foreign, locationId: other.locationId };

        for (const result of [
          await firmPlannedOrder(service, elsewhere),
          await unfirmPlannedOrder(service, elsewhere),
          await updatePlannedOrder(service, { ...elsewhere, quantity: 12 })
        ]) {
          expect(result.error).toMatchObject({ category: "notFound" });
        }
        const applied = await applyPlanningActions(f.service, {
          planningActionIds: [foreignAction]
        });
        expect(applied.data).toMatchObject({ applied: [] });
        expect(applied.data?.errors).toHaveLength(1);

        expect(await read(foreign, other)).toMatchObject({
          status: "Firm",
          quantity: 10,
          firmedBy: USER
        });
        expect(await actionStatus(foreignAction, other)).toBe("Open");
      } finally {
        await other.cleanup();
      }
    }
  );

  databaseTest(
    "a planned order at another location is refused and left as it is",
    async () => {
      const id = await plannedOrder("other-location");
      const elsewhere = { id, locationId: f.otherLocationId };

      for (const result of [
        await firmPlannedOrder(service, elsewhere),
        await unfirmPlannedOrder(service, elsewhere),
        await updatePlannedOrder(service, { ...elsewhere, quantity: 12 })
      ]) {
        expect(result.error).toMatchObject({ category: "conflict" });
      }
      expect(await read(id)).toMatchObject({
        status: "Planned",
        quantity: 10,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "a moved due date moves the order to the week that holds it",
    async () => {
      const moved = await plannedOrder("next-week");
      const result = await updatePlannedOrder(service, {
        id: moved,
        locationId: f.locationId,
        dueDate: "2297-01-10"
      });
      expect(result.error).toBeNull();
      expect(await read(moved)).toMatchObject({
        dueDate: "2297-01-10",
        periodId: nextWeek.id
      });

      // no weekly period holds the new date: refused, nothing changes
      const kept = await plannedOrder("no-week", { splitIndex: 1 });
      const outside = await updatePlannedOrder(service, {
        id: kept,
        locationId: f.locationId,
        quantity: 15,
        dueDate: "2297-03-01"
      });
      expect(outside.error).toMatchObject({
        category: "validation",
        message: "Pick a due date inside the planning horizon"
      });
      expect(await read(kept)).toMatchObject({
        status: "Planned",
        quantity: 10,
        dueDate: "2297-01-05",
        periodId: week.id
      });

      // a quantity edit alone leaves the week as it is
      const sized = await plannedOrder("quantity-only", { splitIndex: 2 });
      await updatePlannedOrder(service, {
        id: sized,
        locationId: f.locationId,
        quantity: 20
      });
      expect(await read(sized)).toMatchObject({
        quantity: 20,
        periodId: week.id
      });
    }
  );

  databaseTest(
    "a change on a planned order is dismissed and reopened on its own worklist only",
    async () => {
      const make = await plannedOrder("worklist-make");
      const actionId = await changeAction("Expedite", make, {
        date: "2297-01-03"
      });

      // a Make planned order is production's: purchasing cannot dismiss it
      const fromPurchasing = await dismissPurchasingPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(fromPurchasing.error).not.toBeNull();
      expect(await actionStatus(actionId)).toBe("Open");

      const dismissed = await dismissProductionPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(dismissed.error).toBeNull();
      expect(await actionStatus(actionId)).toBe("Dismissed");

      const reopened = await reopenProductionPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(reopened.error).toBeNull();
      expect(await actionStatus(actionId)).toBe("Open");
    }
  );

  databaseTest(
    "an applied Defer moves both dates and firms the order",
    async () => {
      const id = await plannedOrder("defer");
      const actionId = await changeAction("Defer", id, { date: "2297-01-08" });

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ applied: [actionId], errors: [] });
      expect(await read(id)).toMatchObject({
        status: "Firm",
        quantity: 10,
        dueDate: "2297-01-08",
        releaseDate: "2297-01-04"
      });
      expect(await actionStatus(actionId)).toBe("Actioned");
    }
  );

  databaseTest(
    "an applied Defer to a date no planning week holds is refused and stays Open",
    async () => {
      const id = await plannedOrder("defer-outside");
      const actionId = await changeAction("Defer", id, { date: "2297-03-01" });

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(result.data?.applied).toEqual([]);
      expect(await read(id)).toMatchObject({
        status: "Planned",
        dueDate: "2297-01-05",
        periodId: week.id
      });
      expect(await actionStatus(actionId)).toBe("Open");
    }
  );

  databaseTest(
    "an applied Cancel deletes the planned order and its action",
    async () => {
      const id = await plannedOrder("cancel", { orderType: "Buy" });
      const actionId = await changeAction("Cancel", id);

      const result = await applyPurchasingPlanningActions(f.service, {
        planningActionIds: [actionId],
        type: "cancel"
      });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        success: true,
        applied: [actionId]
      });
      expect(await read(id)).toBeUndefined();
      expect(await actionStatus(actionId)).toBeNull();
    }
  );

  databaseTest(
    "a Converted planned order is refused, and its action stays Open",
    async () => {
      const id = await plannedOrder("converted", {
        status: "Converted",
        jobId: await seedJob(f, { key: "converted", quantity: 10 })
      });

      const firmed = await firmPlannedOrder(service, {
        id,
        locationId: f.locationId
      });
      expect(firmed.error).toMatchObject({ category: "rule" });

      const actionId = await changeAction("Increase", id, { quantity: 15 });
      const applied = await applyPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(applied.data).toMatchObject({ applied: [] });
      expect(applied.data?.errors).toHaveLength(1);
      expect(await read(id)).toMatchObject({
        status: "Converted",
        quantity: 10
      });
      expect(await actionStatus(actionId)).toBe("Open");
    }
  );

  databaseTest(
    "of two actions on one order that move its date, or change its quantity, the first applies and the second stays Open",
    async () => {
      const id = await plannedOrder("same-field");
      const expedite = await changeAction("Expedite", id, {
        date: "2297-01-03"
      });
      const defer = await changeAction("Defer", id, { date: "2297-01-06" });
      const increase = await changeAction("Increase", id, { quantity: 15 });
      const decrease = await changeAction("Decrease", id, { quantity: 8 });

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [expedite, defer, increase, decrease]
      });
      expect(result.data?.applied).toEqual([expedite, increase]);
      expect(result.data?.errors).toHaveLength(2);
      expect(await read(id)).toMatchObject({
        status: "Firm",
        dueDate: "2297-01-03",
        quantity: 15
      });
      expect(await actionStatus(expedite)).toBe("Actioned");
      expect(await actionStatus(increase)).toBe("Actioned");
      expect(await actionStatus(defer)).toBe("Open");
      expect(await actionStatus(decrease)).toBe("Open");
    }
  );

  databaseTest(
    "a Cancel and an edit of one order in one batch both apply, and the order is gone",
    async () => {
      const id = await plannedOrder("cancel-and-edit");
      const increase = await changeAction("Increase", id, { quantity: 15 });
      const cancel = await changeAction("Cancel", id);

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [increase, cancel]
      });
      expect(result.data).toMatchObject({ errors: [] });
      expect([...(result.data?.applied ?? [])].sort()).toEqual(
        [increase, cancel].sort()
      );
      expect(await read(id)).toBeUndefined();
      // the order's actions go with it
      expect(await actionStatus(increase)).toBeNull();
      expect(await actionStatus(cancel)).toBeNull();
    }
  );

  databaseTest(
    "production's Apply refuses an action on a Buy planned order and leaves it Open",
    async () => {
      const buy = await plannedOrder("buy-on-make", { orderType: "Buy" });
      const increase = await changeAction("Increase", buy, { quantity: 15 });

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [increase]
      });
      expect(result.data).toMatchObject({ applied: [] });
      expect(result.data?.errors).toHaveLength(1);
      expect(await read(buy)).toMatchObject({
        status: "Planned",
        quantity: 10
      });
      expect(await actionStatus(increase)).toBe("Open");
    }
  );

  databaseTest(
    "an action another apply has claimed since it was read is reported already applied, and nothing changes",
    async () => {
      const id = await plannedOrder("applied-twice");
      const defer = await changeAction("Defer", id, { date: "2297-01-08" });
      // as Apply reads it before the claim
      const target = {
        planningActionId: defer,
        plannedOrderId: id,
        type: "Defer" as const,
        suggestedDate: "2297-01-08",
        suggestedQuantity: 10
      };
      const apply = () =>
        applyPlannedOrderTargets(f.db, {
          companyId: f.companyId,
          userId: USER,
          orderType: "Make",
          targets: [target]
        });

      expect(await apply()).toEqual({
        applied: [defer],
        errors: [],
        changedPlannedOrderIds: [id]
      });
      // a person moves the date again before the second apply lands
      await updatePlannedOrder(service, {
        id,
        locationId: f.locationId,
        dueDate: "2297-01-10"
      });
      expect(await apply()).toEqual({
        applied: [],
        errors: [expect.stringContaining(defer)],
        changedPlannedOrderIds: []
      });
      expect(await read(id)).toMatchObject({ dueDate: "2297-01-10" });
      expect(await actionStatus(defer)).toBe("Actioned");
    }
  );

  databaseTest(
    "the planned order's type decides the permission",
    async () => {
      const make = await plannedOrder("make");
      const buy = await plannedOrder("buy", { orderType: "Buy" });
      const purchaser = createServiceContext({
        // Edit on purchasing's Material Planning, nothing on production's
        actor: {
          type: "user",
          role: "employee",
          userId: USER,
          permissions: {
            "purchasing.materialPlanning": {
              view: [f.companyId],
              create: [],
              update: [f.companyId],
              delete: []
            }
          }
        },
        company: { id: f.companyId, groupId: f.service.company.groupId },
        // the operations read and write through `pg` only
        caller: {} as never,
        system: () => ({}) as never,
        pg: () => f.db,
        kv: () => ({}) as never
      });

      const refused = await firmPlannedOrder(purchaser, {
        id: make,
        locationId: f.locationId
      });
      expect(refused.error).toMatchObject({ category: "forbidden" });
      expect(await read(make)).toMatchObject({ status: "Planned" });

      const allowed = await firmPlannedOrder(purchaser, {
        id: buy,
        locationId: f.locationId
      });
      expect(allowed.error).toBeNull();
      expect(await read(buy)).toMatchObject({ status: "Firm" });
    }
  );
});

const client = hasLocalDatabase ? localServiceRoleClient() : null;

describe.skipIf(!client)("a planned order change re-plans", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
  });

  afterEach(async () => {
    await f.cleanup();
  });

  // A planner holding every page of the module. The re-plan runs as the
  // system: a purchasing planner, who may not run MRP, still gets it.
  function planner(module: "production" | "purchasing") {
    const all = [f.companyId];
    return createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: USER,
        permissions: pageClaims({
          [module]: { view: all, create: all, update: all, delete: all }
        })
      },
      company: { id: f.companyId, groupId: f.service.company.groupId },
      caller: client!,
      system: () => client!,
      pg: () => f.db,
      kv: () => {
        throw new Error("No planned order operation reads the cache");
      }
    });
  }

  // Below a reorder point of 1 with no stock, MRP plans the item one order
  // of 5: returns it.
  async function plannedOrderOfFive(itemId: string) {
    await seed(f, (trx) =>
      trx
        .updateTable("itemPlanning")
        .set({
          reorderingPolicy: "Fixed Reorder Quantity",
          reorderPoint: 1,
          reorderQuantity: 5
        })
        .where("companyId", "=", f.companyId)
        .where("locationId", "=", f.locationId)
        .where("itemId", "=", itemId)
        .execute()
    );
    const run = await runMRP(client!, f.db, {
      type: "company",
      id: f.companyId,
      companyId: f.companyId,
      userId: USER
    });
    expect(run.error).toBeNull();
    return f.db
      .selectFrom("plannedOrder")
      .select(["id", "periodId", "dueDate"])
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", itemId)
      .executeTakeFirstOrThrow();
  }

  // The item's Open Order / Make actions, by week.
  function newSupply(itemId: string) {
    return f.db
      .selectFrom("planningAction")
      .select(["type", "periodId", "suggestedQuantity"])
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", itemId)
      .where("type", "in", ["Make", "Order"])
      .where("status", "=", "Open")
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          suggestedQuantity: Number(row.suggestedQuantity)
        }))
      );
  }

  // An Open Increase to 8 on the planned order, as MRP raises on a held one.
  async function increaseToEight(
    itemId: string,
    planned: { id: string; periodId: string; dueDate: string }
  ) {
    return seedPlanningAction(f, {
      key: `increase-${planned.id}`,
      type: "Increase",
      itemId,
      periodId: planned.periodId,
      plannedOrderId: planned.id,
      requiresManualAction: false,
      suggestedQuantity: 8,
      suggestedDate: planned.dueDate
    });
  }

  databaseTest(
    "an edited quantity is the week's Make once the edit returns",
    async () => {
      const planned = await plannedOrderOfFive(f.assemblyId);
      expect(await newSupply(f.assemblyId)).toEqual([
        { type: "Make", periodId: planned.periodId, suggestedQuantity: 5 }
      ]);

      const edited = await updatePlannedOrder(planner("production"), {
        id: planned.id,
        locationId: f.locationId,
        quantity: 8
      });
      expect(edited.error).toBeNull();
      expect(await newSupply(f.assemblyId)).toEqual([
        { type: "Make", periodId: planned.periodId, suggestedQuantity: 8 }
      ]);
    }
  );

  databaseTest(
    "an applied Increase on a Make planned order is the week's Make once Apply returns",
    async () => {
      const planned = await plannedOrderOfFive(f.assemblyId);
      const actionId = await increaseToEight(f.assemblyId, planned);

      const applied = await applyPlanningActions(planner("production"), {
        planningActionIds: [actionId]
      });
      expect(applied.data).toMatchObject({ applied: [actionId], errors: [] });
      expect(await newSupply(f.assemblyId)).toEqual([
        { type: "Make", periodId: planned.periodId, suggestedQuantity: 8 }
      ]);
    }
  );

  databaseTest(
    "an applied Increase on a Buy planned order is the week's Order once Apply returns",
    async () => {
      const planned = await plannedOrderOfFive(f.partId);
      expect(await newSupply(f.partId)).toEqual([
        { type: "Order", periodId: planned.periodId, suggestedQuantity: 5 }
      ]);
      const actionId = await increaseToEight(f.partId, planned);

      const applied = await applyPurchasingPlanningActions(
        planner("purchasing"),
        { planningActionIds: [actionId], type: "apply" }
      );
      expect(applied.data).toMatchObject({ applied: [actionId] });
      expect(await newSupply(f.partId)).toEqual([
        { type: "Order", periodId: planned.periodId, suggestedQuantity: 8 }
      ]);
    }
  );
});
