// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Planning's Make / Order settles the Make / Order actions it answers, and in
// the same transaction converts the planned orders the jobs or PO lines stand
// for: the one an order names (`plannedOrderId`), else one of the settled
// action's week — equal quantity first, a Firm one only by id or quantity.
// Which planned order a document takes is `matchPlannedOrdersToDocuments`,
// tested in production.service.test.ts; these cases pin the reads and writes.

import { afterEach, beforeEach, describe, expect } from "vitest";
import {
  convertPlannedOrdersForActions,
  settleNewSupplyPlanningActions
} from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import {
  type PlanningWeek,
  seedJob,
  seedPlannedOrder,
  seedPlanningAction,
  seedPlanningWeeks,
  seedScrapRate
} from "./fixtures/planning";

let f: Fixture;
let week1: PlanningWeek;
let week2: PlanningWeek;
let removeWeeks: () => Promise<void>;

/** An Order or Make action of week 1, as MRP sums the week's need. */
function newSupplyAction(
  type: "Make" | "Order",
  suggestedQuantity: number,
  key: string,
  status: "Open" | "Dismissed" = "Open"
) {
  return seedPlanningAction(f, {
    key,
    type,
    status,
    periodId: week1.id,
    suggestedQuantity
  });
}

function plannedOrder(
  key: string,
  overrides: Omit<Parameters<typeof seedPlannedOrder>[1], "key" | "week"> & {
    week?: PlanningWeek;
  } = {}
) {
  return seedPlannedOrder(f, { key, week: week1, ...overrides });
}

/**
 * A Planned job of `quantity`, as the settle hands it to the convert: of
 * week 1 unless `periodId` says otherwise.
 */
async function placedJob(
  key: string,
  quantity: number,
  overrides: { plannedOrderId?: string; periodId?: string } = {}
) {
  return {
    documentId: await seedJob(f, { key, quantity }),
    quantity,
    plannedOrderId: overrides.plannedOrderId ?? null,
    itemId: f.partId,
    locationId: f.locationId,
    planningSegmentId: "",
    periodId: overrides.periodId ?? week1.id,
    orderType: "Make" as const
  };
}

function convert(
  documents: Awaited<ReturnType<typeof placedJob>>[],
  asOf?: string
) {
  return convertPlannedOrdersForActions(f.db, {
    companyId: f.companyId,
    userId: USER,
    asOf,
    documents
  });
}

async function purchaseOrderLine(key: string): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-${key}`;
  const lineId = `${f.prefix}-po-line-${key}`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: `PO-${key}`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        status: "Planned",
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values({
        id: lineId,
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 10,
        supplierUnitPrice: 1,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return lineId;
}

async function read(id: string, fixture: Fixture = f) {
  return fixture.db
    .selectFrom("plannedOrder")
    .select([
      "status",
      "quantity",
      "scrapQuantity",
      "jobId",
      "purchaseOrderLineId",
      "firmedBy",
      "updatedBy"
    ])
    .where("id", "=", id)
    .where("companyId", "=", fixture.companyId)
    .executeTakeFirstOrThrow()
    .then((row) => ({
      ...row,
      quantity: Number(row.quantity),
      scrapQuantity: Number(row.scrapQuantity)
    }));
}

describe.skipIf(!hasLocalDatabase)("convertPlannedOrdersForActions", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    const seeded = await seedPlanningWeeks(f, 2, "2299-01-01");
    [week1, week2] = seeded.weeks;
    removeWeeks = seeded.cleanup;
  });

  afterEach(async () => {
    await removeWeeks();
    await f.cleanup();
  });

  databaseTest(
    "a Make that creates 2 jobs converts both planned orders, in split order",
    async () => {
      const actionId = await newSupplyAction("Make", 20, "make");
      // inserted out of order: the split index decides, not the insert
      const second = await plannedOrder("second", { splitIndex: 1 });
      const first = await plannedOrder("first", { splitIndex: 0 });
      const jobA = await seedJob(f, { key: "a", quantity: 10 });
      const jobB = await seedJob(f, { key: "b", quantity: 10 });

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 10,
            planningActionId: actionId,
            jobId: jobA
          },
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 10,
            planningActionId: actionId,
            jobId: jobB
          }
        ]
      });
      expect(result.error).toBeNull();
      expect(await read(first)).toMatchObject({
        status: "Converted",
        jobId: jobA,
        purchaseOrderLineId: null,
        updatedBy: USER
      });
      expect(await read(second)).toMatchObject({
        status: "Converted",
        jobId: jobB,
        purchaseOrderLineId: null
      });
    }
  );

  databaseTest(
    "an Order converts its Buy planned order to the PO line",
    async () => {
      const actionId = await newSupplyAction("Order", 10, "order");
      const buy = await plannedOrder("buy", { orderType: "Buy" });
      // a Make planned order of the same week is not the Order's
      const make = await plannedOrder("make");
      const lineId = await purchaseOrderLine("1");

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Order",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 10,
            planningActionId: actionId,
            purchaseOrderLineId: lineId
          }
        ]
      });
      expect(result.error).toBeNull();
      expect(await read(buy)).toMatchObject({
        status: "Converted",
        jobId: null,
        purchaseOrderLineId: lineId
      });
      expect(await read(make)).toMatchObject({
        status: "Planned",
        jobId: null,
        purchaseOrderLineId: null
      });
    }
  );

  databaseTest(
    "a Firm planned order is converted too, and drops its firm stamp",
    async () => {
      const firm = await plannedOrder("firm", { status: "Firm" });
      const job = await placedJob("firm", 10, { plannedOrderId: firm });
      expect(await convert([job])).toEqual([
        { id: firm, jobId: job.documentId, purchaseOrderLineId: null }
      ]);
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        jobId: job.documentId,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "another week's planned order and a planned order with no job are left alone",
    async () => {
      const actionId = await newSupplyAction("Make", 30, "partial");
      const first = await plannedOrder("w1-0", { splitIndex: 0 });
      const extra = await plannedOrder("w1-1", { splitIndex: 1 });
      const otherWeek = await plannedOrder("w2", { week: week2 });
      const jobId = await seedJob(f, { key: "partial", quantity: 10 });

      // one job of 10 against a need of 30: the action stays Open at 20,
      // and the job still converts one planned order
      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 10,
            planningActionId: actionId,
            jobId
          }
        ]
      });
      expect(result.data).toEqual([
        expect.objectContaining({ id: actionId, status: "Open" })
      ]);
      expect(await read(first)).toMatchObject({ status: "Converted", jobId });
      expect(await read(extra)).toMatchObject({
        status: "Planned",
        jobId: null
      });
      expect(await read(otherWeek)).toMatchObject({
        status: "Planned",
        jobId: null
      });
    }
  );

  databaseTest(
    "a Converted planned order is never linked again",
    async () => {
      const done = await plannedOrder("done", { splitIndex: 0 });
      const open = await plannedOrder("open", { splitIndex: 1 });
      const jobA = await placedJob("first-run", 10);
      const jobB = await placedJob("second-run", 10);
      await convert([jobA]);
      await convert([jobB]);
      expect(await read(done)).toMatchObject({
        status: "Converted",
        jobId: jobA.documentId
      });
      expect(await read(open)).toMatchObject({
        status: "Converted",
        jobId: jobB.documentId
      });
    }
  );

  databaseTest(
    "a job that names its planned order converts that one, not the first by split",
    async () => {
      const actionId = await newSupplyAction("Make", 20, "named");
      const first = await plannedOrder("named-0", { splitIndex: 0 });
      const second = await plannedOrder("named-1", { splitIndex: 1 });
      const jobId = await seedJob(f, { key: "named", quantity: 10 });

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 10,
            planningActionId: actionId,
            plannedOrderId: second,
            jobId
          }
        ]
      });
      expect(result.error).toBeNull();
      expect(await read(second)).toMatchObject({ status: "Converted", jobId });
      expect(await read(first)).toMatchObject({
        status: "Planned",
        jobId: null
      });
    }
  );

  databaseTest(
    "a job naming another company's planned order converts its own week's, and the other company's is left alone",
    async () => {
      const other = await alwaysPostFixture();
      try {
        const foreign = await seedPlannedOrder(other, {
          key: "foreign",
          week: week1
        });
        const own = await plannedOrder("own");
        const job = await placedJob("foreign-id", 10, {
          plannedOrderId: foreign
        });
        expect(await convert([job])).toEqual([
          { id: own, jobId: job.documentId, purchaseOrderLineId: null }
        ]);
        expect(await read(foreign, other)).toMatchObject({
          status: "Planned",
          quantity: 10,
          jobId: null
        });
      } finally {
        await other.cleanup();
      }
    }
  );

  databaseTest(
    "a smaller job with no id takes its quantity off a Planned order, never the Firm one",
    async () => {
      const actionId = await newSupplyAction("Make", 30, "firm-kept");
      // the Firm order sorts first by split: a guess by position took it
      const firm = await plannedOrder("firm-kept-0", {
        splitIndex: 0,
        status: "Firm",
        quantity: 20
      });
      const planned = await plannedOrder("firm-kept-1", { splitIndex: 1 });
      const jobId = await seedJob(f, { key: "smaller", quantity: 5 });

      await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1.id,
            quantity: 5,
            planningActionId: actionId,
            jobId
          }
        ]
      });
      expect(await read(firm)).toMatchObject({
        status: "Firm",
        jobId: null,
        firmedBy: USER
      });
      expect(await read(planned)).toMatchObject({
        status: "Planned",
        quantity: 5,
        jobId: null
      });
    }
  );

  databaseTest(
    "a job with no id converts the planned order of its own quantity",
    async () => {
      const ten = await plannedOrder("qty-10", { splitIndex: 0 });
      const twenty = await plannedOrder("qty-20", {
        splitIndex: 1,
        quantity: 20
      });
      const firm = await plannedOrder("qty-5-firm", {
        splitIndex: 2,
        quantity: 5,
        status: "Firm"
      });
      // a 12 matches nothing: it converts the next Planned order by split,
      // after the equal quantities are matched
      const twelve = await placedJob("qty-12", 12);
      const jobOfTwenty = await placedJob("qty-20", 20);
      // a Firm order converts by its own quantity
      const five = await placedJob("qty-5", 5);

      await convert([twelve, jobOfTwenty, five]);
      expect(await read(twenty)).toMatchObject({
        status: "Converted",
        jobId: jobOfTwenty.documentId
      });
      expect(await read(ten)).toMatchObject({
        status: "Converted",
        jobId: twelve.documentId
      });
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        jobId: five.documentId,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "a larger job reduces the next Planned orders of its week and deletes one it covers whole",
    async () => {
      // week 1: 250 with no id = A 100 (converted) + B 100 (deleted) + 50 of C
      const a = await plannedOrder("cover-a", { splitIndex: 0, quantity: 100 });
      const b = await plannedOrder("cover-b", { splitIndex: 1, quantity: 100 });
      const c = await plannedOrder("cover-c", { splitIndex: 2, quantity: 100 });
      // week 2: 80 naming D = D 50 (converted) + 30 of E
      const d = await plannedOrder("named-d", {
        week: week2,
        splitIndex: 0,
        quantity: 50
      });
      const e = await plannedOrder("named-e", {
        week: week2,
        splitIndex: 1,
        quantity: 50
      });
      const unnamed = await placedJob("cover-250", 250);
      const named = await placedJob("named-80", 80, {
        plannedOrderId: d,
        periodId: week2.id
      });

      await convert([unnamed, named]);
      const left = await f.db
        .selectFrom("plannedOrder")
        .select(["id", "status", "quantity", "jobId"])
        .where("companyId", "=", f.companyId)
        .where("id", "in", [a, b, c, d, e])
        .orderBy("periodId")
        .orderBy("splitIndex")
        .execute();
      expect(
        left.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([
        { id: a, status: "Converted", quantity: 100, jobId: unnamed.documentId },
        { id: c, status: "Planned", quantity: 50, jobId: null },
        { id: d, status: "Converted", quantity: 50, jobId: named.documentId },
        { id: e, status: "Planned", quantity: 20, jobId: null }
      ]);
    }
  );

  databaseTest(
    "reducing a planned order deletes its open and dismissed change actions",
    async () => {
      const firm = await plannedOrder("reduced-firm", {
        splitIndex: 0,
        status: "Firm",
        quantity: 100
      });
      const planned = await plannedOrder("reduced-planned", {
        splitIndex: 1,
        quantity: 100
      });
      // sized for 100: once a job covers part of it they would push the
      // order back up
      for (const target of [firm, planned]) {
        await seedPlanningAction(f, {
          key: `${target}-increase`,
          type: "Increase",
          periodId: week1.id,
          plannedOrderId: target,
          suggestedQuantity: 115
        });
        await seedPlanningAction(f, {
          key: `${target}-decrease`,
          type: "Decrease",
          status: "Dismissed",
          periodId: week1.id,
          plannedOrderId: target,
          suggestedQuantity: 80
        });
      }

      await convert([
        await placedJob("reduce-named-40", 40, { plannedOrderId: firm }),
        // the Firm order is never a fallback: this takes the Planned one
        await placedJob("reduce-unnamed-30", 30)
      ]);
      expect(await read(firm)).toMatchObject({ status: "Firm", quantity: 60 });
      expect(await read(planned)).toMatchObject({
        status: "Planned",
        quantity: 70
      });
      const actions = await f.db
        .selectFrom("planningAction")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("plannedOrderId", "in", [firm, planned])
        .execute();
      expect(actions).toEqual([]);
    }
  );

  databaseTest(
    "converting deletes the open and dismissed change actions on the planned order",
    async () => {
      const target = await plannedOrder("acted");
      // the natural key allows one non-Actioned row per target and type
      for (const [type, status] of [
        ["Expedite", "Open"],
        ["Expedite", "Actioned"],
        ["Defer", "Dismissed"]
      ] as const) {
        await seedPlanningAction(f, {
          key: `change-${status}`,
          type,
          status,
          periodId: week1.id,
          plannedOrderId: target
        });
      }

      await convert([
        await placedJob("acted", 10, { plannedOrderId: target })
      ]);
      const left = await f.db
        .selectFrom("planningAction")
        .select(["id", "status"])
        .where("companyId", "=", f.companyId)
        .where("plannedOrderId", "=", target)
        .execute();
      expect(left).toEqual([
        { id: `${f.prefix}-action-change-Actioned`, status: "Actioned" }
      ]);
    }
  );

  databaseTest(
    "the current week's job takes an overdue planned order only once last week's Make is no longer Open or Dismissed",
    async () => {
      // the week turned (today is in week 2) and last week's Make, which
      // counted the overdue order, was dismissed: the drawer offered the
      // current week's job only week 2's order, and the convert agrees
      const lastWeek = await newSupplyAction(
        "Make",
        10,
        "dismissed-last-week",
        "Dismissed"
      );
      const overdue = await plannedOrder("dismissed-overdue");
      const current = await plannedOrder("dismissed-current", {
        week: week2,
        quantity: 20
      });
      const today = "2299-01-10";
      expect(
        await convert(
          [await placedJob("current", 10, { periodId: week2.id })],
          today
        )
      ).toEqual([]);
      expect(await read(overdue)).toMatchObject({
        status: "Planned",
        quantity: 10
      });
      expect(await read(current)).toMatchObject({
        status: "Planned",
        quantity: 10
      });

      // with last week's Make settled, the current week holds the overdue
      // order: of two equal orders, the one due first
      await seed(f, (trx) =>
        trx
          .updateTable("planningAction")
          .set({ status: "Actioned" })
          .where("id", "=", lastWeek)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const next = await placedJob("next", 10, { periodId: week2.id });
      expect(await convert([next], today)).toEqual([
        { id: overdue, jobId: next.documentId, purchaseOrderLineId: null }
      ]);
    }
  );

  databaseTest(
    "a smaller job with no id takes its quantity off the next Planned order, restates its scrap, and leaves it Planned",
    async () => {
      await seedScrapRate(f, f.partId, 0.15);
      const planned = await plannedOrder("reduce-planned", { quantity: 100 });
      expect(await convert([await placedJob("reduce-planned-10", 10)])).toEqual(
        []
      );
      // scrap of 90 at 15 % = 13.5, rounded up
      expect(await read(planned)).toMatchObject({
        status: "Planned",
        quantity: 90,
        scrapQuantity: 14,
        jobId: null
      });

      // the jobs that follow count against what is left: of 85 and 5 in
      // one batch, the 5 reaches it and converts it
      const more = await placedJob("reduce-planned-85", 85);
      const last = await placedJob("reduce-planned-5", 5);
      await convert([more, last]);
      expect(await read(planned)).toMatchObject({
        status: "Converted",
        jobId: last.documentId
      });
    }
  );

  databaseTest(
    "a smaller job that names a Firm planned order takes its quantity off and leaves it Firm",
    async () => {
      const firm = await plannedOrder("reduce-firm", {
        status: "Firm",
        quantity: 100
      });
      expect(
        await convert([
          await placedJob("reduce-40", 40, { plannedOrderId: firm })
        ])
      ).toEqual([]);
      expect(await read(firm)).toMatchObject({
        status: "Firm",
        quantity: 60,
        jobId: null,
        firmedBy: USER
      });

      // a job of all that is left converts it
      const rest = await placedJob("reduce-60", 60, { plannedOrderId: firm });
      await convert([rest]);
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        quantity: 60,
        jobId: rest.documentId,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "a job with no id converts a planned order of its week by due date, not by its stored week",
    async () => {
      // stored in week 1, due in week 2: it is week 2's
      const moved = await plannedOrder("stored-week-1", {
        dueDate: "2299-01-10"
      });
      const asOf = "2299-01-01";
      expect(await convert([await placedJob("due-week-1", 10)], asOf)).toEqual(
        []
      );
      const job = await placedJob("due-week-2", 10, { periodId: week2.id });
      expect(await convert([job], asOf)).toEqual([
        { id: moved, jobId: job.documentId, purchaseOrderLineId: null }
      ]);
    }
  );
});
