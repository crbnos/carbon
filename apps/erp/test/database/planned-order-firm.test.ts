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
import { runMRP } from "../../app/modules/production/production.service";
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

let f: Fixture;
// The system with no Supabase client: the MRP run a change starts fails at
// its first read, and the change must stand.
let service: ServiceContext;
let week: string;
let nextWeek: string;

async function plannedOrder(
  key: string,
  overrides: {
    orderType?: "Make" | "Buy";
    status?: "Planned" | "Firm" | "Converted";
    splitIndex?: number;
    jobId?: string;
  } = {}
): Promise<string> {
  const id = `${f.prefix}-planned-${key}`;
  const status = overrides.status ?? "Planned";
  await seed(f, (trx) =>
    trx
      .insertInto("plannedOrder")
      .values({
        id,
        companyId: f.companyId,
        itemId: f.partId,
        locationId: f.locationId,
        planningSegmentId: "",
        orderType: overrides.orderType ?? "Make",
        status,
        firmedBy: status === "Firm" ? USER : null,
        firmedAt: status === "Firm" ? f.today : null,
        jobId: overrides.jobId ?? null,
        quantity: 10,
        dueDate: "2297-01-05",
        releaseDate: "2297-01-01",
        periodId: week,
        splitIndex: overrides.splitIndex ?? 0,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function changeAction(
  type: "Expedite" | "Defer" | "Increase" | "Decrease" | "Cancel",
  plannedOrderId: string,
  suggested: { date?: string; quantity?: number } = {}
): Promise<string> {
  const id = `${f.prefix}-action-${type}-${plannedOrderId}`;
  await seed(f, (trx) =>
    trx
      .insertInto("planningAction")
      .values({
        id,
        companyId: f.companyId,
        type,
        status: "Open",
        itemId: f.partId,
        locationId: f.locationId,
        periodId: week,
        planningSegmentId: "",
        plannedOrderId,
        requiresManualAction: false,
        suggestedQuantity: suggested.quantity ?? 10,
        suggestedDate: suggested.date ?? "2297-01-05",
        horizonDate: f.today,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function job(key: string): Promise<string> {
  const id = `${f.prefix}-job-${key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("job")
      .values({
        id,
        jobId: `J-${key}`,
        itemId: f.partId,
        quantity: 10,
        status: "Planned",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function read(id: string) {
  const row = await f.db
    .selectFrom("plannedOrder")
    .select([
      "status",
      "quantity",
      "dueDate",
      "releaseDate",
      "splitIndex",
      "firmedBy",
      "firmedAt",
      "periodId"
    ])
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirst();
  return row && { ...row, quantity: Number(row.quantity) };
}

async function actionStatus(id: string) {
  const row = await f.db
    .selectFrom("planningAction")
    .select("status")
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
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
    week = `${f.prefix}-week`;
    nextWeek = `${f.prefix}-next-week`;
    // `period` has no company: these are the test's own, removed after.
    await seed(f, (trx) =>
      trx
        .insertInto("period")
        .values([
          {
            id: week,
            startDate: "2297-01-01",
            endDate: "2297-01-07",
            periodType: "Week"
          },
          {
            id: nextWeek,
            startDate: "2297-01-08",
            endDate: "2297-01-14",
            periodType: "Week"
          }
        ])
        .execute()
    );
  });

  afterEach(async () => {
    // the planned orders and their actions go with the period (ON DELETE CASCADE)
    await f.db
      .deleteFrom("period")
      .where("id", "in", [week, nextWeek])
      .execute();
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
    "an edit firms the order and moves the release date with the due date",
    async () => {
      const id = await plannedOrder("edit");

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
        dueDate: "2297-01-12",
        // 2297-01-01 moved by the same 7 days
        releaseDate: "2297-01-08"
      });
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
        periodId: nextWeek
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
        periodId: week
      });

      // a quantity edit alone leaves the week as it is
      const sized = await plannedOrder("quantity-only", { splitIndex: 2 });
      await updatePlannedOrder(service, {
        id: sized,
        locationId: f.locationId,
        quantity: 20
      });
      expect(await read(sized)).toMatchObject({ quantity: 20, periodId: week });
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
        periodId: week
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
        jobId: await job("converted")
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
    "the planned order's type decides the permission",
    async () => {
      const make = await plannedOrder("make");
      const buy = await plannedOrder("buy", { orderType: "Buy" });
      const purchaser = createServiceContext({
        actor: {
          type: "user",
          userId: USER,
          permissions: {
            purchasing: {
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

  // A planner who may change planned orders of the module, and may not run
  // MRP on their own.
  function planner(module: "production" | "purchasing") {
    const all = [f.companyId];
    return createServiceContext({
      actor: {
        type: "user",
        userId: USER,
        permissions: {
          [module]: { view: all, create: all, update: all, delete: all }
        }
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
    const id = `${f.prefix}-action-increase-${planned.id}`;
    await seed(f, (trx) =>
      trx
        .insertInto("planningAction")
        .values({
          id,
          companyId: f.companyId,
          type: "Increase",
          status: "Open",
          itemId,
          locationId: f.locationId,
          periodId: planned.periodId,
          planningSegmentId: "",
          plannedOrderId: planned.id,
          requiresManualAction: false,
          suggestedQuantity: 8,
          suggestedDate: planned.dueDate,
          horizonDate: f.today,
          createdBy: USER
        })
        .execute()
    );
    return id;
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
