// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A person firms, unfirms and edits a planned order; Apply on a change action
// that targets a planned order edits (and firms) or deletes it. A Converted
// planned order is the history of its job or PO line and never changes.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { afterEach, beforeEach, describe, expect } from "vitest";
import {
  applyPlanningActions,
  firmPlannedOrder,
  unfirmPlannedOrder,
  updatePlannedOrder
} from "../../app/modules/production/production.server";
import { applyPlanningActions as applyPurchasingPlanningActions } from "../../app/modules/purchasing/purchasing.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

let f: Fixture;
let week: string;

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
        dueDate: "2299-01-05",
        releaseDate: "2299-01-01",
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
        suggestedDate: suggested.date ?? "2299-01-05",
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
      "firmedAt"
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
    week = `${f.prefix}-week`;
    // `period` has no company: this one is the test's own, removed after.
    await seed(f, (trx) =>
      trx
        .insertInto("period")
        .values({
          id: week,
          startDate: "2299-01-01",
          endDate: "2299-01-07",
          periodType: "Week"
        })
        .execute()
    );
  });

  afterEach(async () => {
    // the planned orders and their actions go with the period (ON DELETE CASCADE)
    await f.db.deleteFrom("period").where("id", "=", week).execute();
    await f.cleanup();
  });

  databaseTest(
    "firm stamps the person, and unfirm gives the order back to MRP",
    async () => {
      const id = await plannedOrder("firm");

      const firmed = await firmPlannedOrder(f.service, { id });
      expect(firmed.error).toBeNull();
      const afterFirm = await read(id);
      expect(afterFirm).toMatchObject({ status: "Firm", firmedBy: USER });
      expect(afterFirm?.firmedAt).not.toBeNull();

      const unfirmed = await unfirmPlannedOrder(f.service, { id });
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

      const unfirmed = await unfirmPlannedOrder(f.service, { id: firm });
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

      const result = await updatePlannedOrder(f.service, {
        id,
        quantity: 12,
        dueDate: "2299-01-12"
      });
      expect(result.error).toBeNull();
      expect(await read(id)).toMatchObject({
        status: "Firm",
        firmedBy: USER,
        quantity: 12,
        dueDate: "2299-01-12",
        // 2299-01-01 moved by the same 7 days
        releaseDate: "2299-01-08"
      });
    }
  );

  databaseTest(
    "an applied Defer moves both dates and firms the order",
    async () => {
      const id = await plannedOrder("defer");
      const actionId = await changeAction("Defer", id, { date: "2299-01-08" });

      const result = await applyPlanningActions(f.service, {
        planningActionIds: [actionId]
      });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ applied: [actionId], errors: [] });
      expect(await read(id)).toMatchObject({
        status: "Firm",
        quantity: 10,
        dueDate: "2299-01-08",
        releaseDate: "2299-01-04"
      });
      expect(await actionStatus(actionId)).toBe("Actioned");
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

      const firmed = await firmPlannedOrder(f.service, { id });
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

      const refused = await firmPlannedOrder(purchaser, { id: make });
      expect(refused.error).toMatchObject({ category: "forbidden" });
      expect(await read(make)).toMatchObject({ status: "Planned" });

      const allowed = await firmPlannedOrder(purchaser, { id: buy });
      expect(allowed.error).toBeNull();
      expect(await read(buy)).toMatchObject({ status: "Firm" });
    }
  );
});
