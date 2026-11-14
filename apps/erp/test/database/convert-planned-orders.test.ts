// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Planning's Make / Order settles the Make / Order actions it answers, and in
// the same transaction converts the planned orders the jobs or PO lines stand
// for: the one an order names (`plannedOrderId`), else one of the settled
// action's week — equal quantity first, a Firm one only by id or quantity.

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

let f: Fixture;
let week1: string;
let week2: string;

async function action(
  type: "Make" | "Order",
  suggestedQuantity: number,
  key: string
): Promise<string> {
  const id = `${f.prefix}-action-${key}`;
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
        periodId: week1,
        planningSegmentId: "",
        suggestedQuantity,
        suggestedDate: f.today,
        horizonDate: f.today,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function plannedOrder(
  overrides: {
    orderType: "Make" | "Buy";
    splitIndex?: number;
    periodId?: string;
    firm?: boolean;
    quantity?: number;
    dueDate?: string;
  },
  key: string
): Promise<string> {
  const id = `${f.prefix}-planned-${key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("plannedOrder")
      .values({
        id,
        companyId: f.companyId,
        itemId: f.partId,
        locationId: f.locationId,
        planningSegmentId: "",
        orderType: overrides.orderType,
        status: overrides.firm ? "Firm" : "Planned",
        firmedBy: overrides.firm ? USER : null,
        firmedAt: overrides.firm ? f.today : null,
        quantity: overrides.quantity ?? 10,
        dueDate: overrides.dueDate ?? "2299-01-05",
        releaseDate: "2299-01-01",
        periodId: overrides.periodId ?? week1,
        splitIndex: overrides.splitIndex ?? 0,
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

/** A job placed from planning, as the settle hands it to the convert. */
function document(
  documentId: string,
  overrides: { plannedOrderId?: string; quantity?: number } = {}
) {
  return {
    documentId,
    quantity: overrides.quantity ?? 10,
    plannedOrderId: overrides.plannedOrderId ?? null,
    itemId: f.partId,
    locationId: f.locationId,
    planningSegmentId: "",
    periodId: week1,
    orderType: "Make" as const
  };
}

async function read(id: string) {
  return f.db
    .selectFrom("plannedOrder")
    .select([
      "status",
      "quantity",
      "jobId",
      "purchaseOrderLineId",
      "firmedBy",
      "updatedBy"
    ])
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow()
    .then((row) => ({ ...row, quantity: Number(row.quantity) }));
}

describe.skipIf(!hasLocalDatabase)("convertPlannedOrdersForActions", () => {
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
    // the actions and planned orders go with the periods (ON DELETE CASCADE)
    await f.db.deleteFrom("period").where("id", "in", [week1, week2]).execute();
    await f.cleanup();
  });

  databaseTest(
    "a Make that creates 2 jobs converts both planned orders, in split order",
    async () => {
      const actionId = await action("Make", 20, "make");
      // inserted out of order: the split index decides, not the insert
      const second = await plannedOrder(
        { orderType: "Make", splitIndex: 1 },
        "second"
      );
      const first = await plannedOrder(
        { orderType: "Make", splitIndex: 0 },
        "first"
      );
      const jobA = await job("a");
      const jobB = await job("b");

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1,
            quantity: 10,
            planningActionId: actionId,
            jobId: jobA
          },
          {
            itemId: f.partId,
            periodId: week1,
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
      const actionId = await action("Order", 10, "order");
      const buy = await plannedOrder({ orderType: "Buy" }, "buy");
      // a Make planned order of the same week is not the Order's
      const make = await plannedOrder({ orderType: "Make" }, "make");
      const lineId = await purchaseOrderLine("1");

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Order",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1,
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
      const firm = await plannedOrder(
        { orderType: "Make", firm: true },
        "firm"
      );
      const jobId = await job("firm");
      const converted = await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(jobId, { plannedOrderId: firm })]
      });
      expect(converted).toEqual([
        { id: firm, jobId, purchaseOrderLineId: null }
      ]);
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        jobId,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "another week's planned order and a planned order with no job are left alone",
    async () => {
      const actionId = await action("Make", 30, "partial");
      const first = await plannedOrder(
        { orderType: "Make", splitIndex: 0 },
        "w1-0"
      );
      const extra = await plannedOrder(
        { orderType: "Make", splitIndex: 1 },
        "w1-1"
      );
      const otherWeek = await plannedOrder(
        { orderType: "Make", periodId: week2 },
        "w2"
      );
      const jobId = await job("partial");

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
            periodId: week1,
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
      const done = await plannedOrder(
        { orderType: "Make", splitIndex: 0 },
        "done"
      );
      const open = await plannedOrder(
        { orderType: "Make", splitIndex: 1 },
        "open"
      );
      const jobA = await job("first-run");
      const jobB = await job("second-run");
      const convert = (documentId: string) =>
        convertPlannedOrdersForActions(f.db, {
          companyId: f.companyId,
          userId: USER,
          documents: [document(documentId)]
        });
      await convert(jobA);
      await convert(jobB);
      expect(await read(done)).toMatchObject({
        status: "Converted",
        jobId: jobA
      });
      expect(await read(open)).toMatchObject({
        status: "Converted",
        jobId: jobB
      });
    }
  );
  databaseTest(
    "a job that names its planned order converts that one, not the first by split",
    async () => {
      const actionId = await action("Make", 20, "named");
      const first = await plannedOrder(
        { orderType: "Make", splitIndex: 0 },
        "named-0"
      );
      const second = await plannedOrder(
        { orderType: "Make", splitIndex: 1 },
        "named-1"
      );
      const jobId = await job("named");

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1,
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
    "a smaller job with no id takes its quantity off a Planned order, never the Firm one",
    async () => {
      const actionId = await action("Make", 30, "firm-kept");
      // the Firm order sorts first by split: a guess by position took it
      const firm = await plannedOrder(
        { orderType: "Make", splitIndex: 0, firm: true, quantity: 20 },
        "firm-kept-0"
      );
      const planned = await plannedOrder(
        { orderType: "Make", splitIndex: 1 },
        "firm-kept-1"
      );
      const jobId = await job("smaller");

      await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1,
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
      const ten = await plannedOrder(
        { orderType: "Make", splitIndex: 0 },
        "qty-10"
      );
      const twenty = await plannedOrder(
        { orderType: "Make", splitIndex: 1, quantity: 20 },
        "qty-20"
      );
      const firm = await plannedOrder(
        { orderType: "Make", splitIndex: 2, quantity: 5, firm: true },
        "qty-5-firm"
      );
      const jobA = await job("qty-20");
      const jobB = await job("qty-12");
      const jobC = await job("qty-5");

      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [
          // a 12 matches nothing: it converts the next Planned order by
          // split, after the equal quantities are matched
          document(jobB, { quantity: 12 }),
          document(jobA, { quantity: 20 }),
          // a Firm order converts by its own quantity
          document(jobC, { quantity: 5 })
        ]
      });
      expect(await read(twenty)).toMatchObject({
        status: "Converted",
        jobId: jobA
      });
      expect(await read(ten)).toMatchObject({
        status: "Converted",
        jobId: jobB
      });
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        jobId: jobC,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "a job whose planned order id is stale or of another type converts a planned order of its week",
    async () => {
      const buy = await plannedOrder({ orderType: "Buy" }, "wrong-type");
      const make = await plannedOrder({ orderType: "Make" }, "week-make");
      const wrongType = await job("wrong-type");
      const gone = await job("gone");
      const converted = await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [
          document(wrongType, { plannedOrderId: buy }),
          // the week has nothing left for this one
          document(gone, { plannedOrderId: `${f.prefix}-gone` })
        ]
      });
      expect(converted).toEqual([
        { id: make, jobId: wrongType, purchaseOrderLineId: null }
      ]);
      expect(await read(buy)).toMatchObject({ status: "Planned" });
    }
  );

  databaseTest(
    "a job with no id larger than the next Planned order takes the excess off the one after",
    async () => {
      const a = await plannedOrder(
        { orderType: "Make", splitIndex: 0, quantity: 100 },
        "excess-a"
      );
      const b = await plannedOrder(
        { orderType: "Make", splitIndex: 1, quantity: 100 },
        "excess-b"
      );
      const jobId = await job("excess-150");
      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(jobId, { quantity: 150 })]
      });
      expect(await read(a)).toMatchObject({ status: "Converted", jobId });
      expect(await read(b)).toMatchObject({
        status: "Planned",
        quantity: 50,
        jobId: null
      });
    }
  );

  databaseTest(
    "a job with no id deletes a following Planned order its excess covers whole",
    async () => {
      const a = await plannedOrder(
        { orderType: "Make", splitIndex: 0, quantity: 100 },
        "cover-a"
      );
      const b = await plannedOrder(
        { orderType: "Make", splitIndex: 1, quantity: 100 },
        "cover-b"
      );
      const c = await plannedOrder(
        { orderType: "Make", splitIndex: 2, quantity: 100 },
        "cover-c"
      );
      const jobId = await job("cover-250");
      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(jobId, { quantity: 250 })]
      });
      const left = await f.db
        .selectFrom("plannedOrder")
        .select(["id", "status", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("id", "in", [a, b, c])
        .orderBy("splitIndex")
        .execute();
      expect(
        left.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([
        { id: a, status: "Converted", quantity: 100 },
        { id: c, status: "Planned", quantity: 50 }
      ]);
    }
  );

  databaseTest(
    "reducing a planned order deletes its open and dismissed change actions",
    async () => {
      const firm = await plannedOrder(
        { orderType: "Make", splitIndex: 0, firm: true, quantity: 100 },
        "reduced-firm"
      );
      const planned = await plannedOrder(
        { orderType: "Make", splitIndex: 1, quantity: 100 },
        "reduced-planned"
      );
      // sized for 100: once a job covers part of it they would push the
      // order back up
      for (const target of [firm, planned]) {
        await seed(f, (trx) =>
          trx
            .insertInto("planningAction")
            .values(
              (
                [
                  ["Increase", "Open", 115],
                  ["Decrease", "Dismissed", 80]
                ] as const
              ).map(([type, status, suggestedQuantity]) => ({
                id: `${target}-${type}`,
                companyId: f.companyId,
                type,
                status,
                itemId: f.partId,
                locationId: f.locationId,
                periodId: week1,
                planningSegmentId: "",
                plannedOrderId: target,
                suggestedQuantity,
                suggestedDate: f.today,
                horizonDate: f.today,
                createdBy: USER
              }))
            )
            .execute()
        );
      }
      const named = await job("reduce-named-40");
      const unnamed = await job("reduce-unnamed-30");

      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [
          document(named, { plannedOrderId: firm, quantity: 40 }),
          // the Firm order is never a fallback: this takes the Planned one
          document(unnamed, { quantity: 30 })
        ]
      });
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
      const target = await plannedOrder({ orderType: "Make" }, "acted");
      const changeAction = (status: "Open" | "Dismissed" | "Actioned") =>
        seed(f, (trx) =>
          trx
            .insertInto("planningAction")
            .values({
              id: `${f.prefix}-change-${status}`,
              companyId: f.companyId,
              type: "Expedite",
              status,
              itemId: f.partId,
              locationId: f.locationId,
              periodId: week1,
              planningSegmentId: "",
              plannedOrderId: target,
              suggestedQuantity: 10,
              suggestedDate: f.today,
              horizonDate: f.today,
              createdBy: USER
            })
            .execute()
        );
      // the natural key allows one non-Actioned row per target and type
      await changeAction("Open");
      await changeAction("Actioned");
      await seed(f, (trx) =>
        trx
          .insertInto("planningAction")
          .values({
            id: `${f.prefix}-change-Dismissed`,
            companyId: f.companyId,
            type: "Defer",
            status: "Dismissed",
            itemId: f.partId,
            locationId: f.locationId,
            periodId: week1,
            planningSegmentId: "",
            plannedOrderId: target,
            suggestedQuantity: 10,
            suggestedDate: f.today,
            horizonDate: f.today,
            createdBy: USER
          })
          .execute()
      );
      const jobId = await job("acted");

      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(jobId, { plannedOrderId: target })]
      });
      const left = await f.db
        .selectFrom("planningAction")
        .select(["id", "status"])
        .where("companyId", "=", f.companyId)
        .where("plannedOrderId", "=", target)
        .execute();
      expect(left).toEqual([
        { id: `${f.prefix}-change-Actioned`, status: "Actioned" }
      ]);
    }
  );
  databaseTest(
    "the current week's job with no id converts an overdue planned order of an older week",
    async () => {
      // MRP sizes an overdue planned order in the current week (week 2 on
      // 2299-01-10) and sums it into that week's Make; the row keeps week 1
      const overdue = await plannedOrder({ orderType: "Make" }, "overdue");
      const jobId = await job("overdue");
      const convert = (asOf: string) =>
        convertPlannedOrdersForActions(f.db, {
          companyId: f.companyId,
          userId: USER,
          asOf,
          documents: [{ ...document(jobId), periodId: week2 }]
        });

      // week 2 is not the current week yet: an older week is not its own
      expect(await convert("2299-01-01")).toEqual([]);
      expect(await convert("2299-01-10")).toEqual([
        { id: overdue, jobId, purchaseOrderLineId: null }
      ]);
    }
  );

  databaseTest(
    "a smaller job with no id takes its quantity off the next Planned order and leaves it Planned",
    async () => {
      const planned = await plannedOrder(
        { orderType: "Make", quantity: 100 },
        "reduce-planned"
      );
      const small = await job("reduce-planned-10");
      expect(
        await convertPlannedOrdersForActions(f.db, {
          companyId: f.companyId,
          userId: USER,
          documents: [document(small, { quantity: 10 })]
        })
      ).toEqual([]);
      expect(await read(planned)).toMatchObject({
        status: "Planned",
        quantity: 90,
        jobId: null
      });

      // the jobs that follow count against what is left: of 85 and 5 in
      // one batch, the 5 reaches it and converts it
      const more = await job("reduce-planned-85");
      const last = await job("reduce-planned-5");
      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [
          document(more, { quantity: 85 }),
          document(last, { quantity: 5 })
        ]
      });
      expect(await read(planned)).toMatchObject({
        status: "Converted",
        jobId: last
      });
    }
  );

  databaseTest(
    "a job settled against last week's action converts the planned order now overdue",
    async () => {
      // the week turned (today is in week 2) and MRP has not run again: the
      // Make still names week 1, and its planned order is overdue
      const actionId = await action("Make", 10, "last-week");
      const overdue = await plannedOrder({ orderType: "Make" }, "last-week");
      const jobId = await job("last-week");

      const result = await settleNewSupplyPlanningActions(f.db, {
        companyId: f.companyId,
        locationId: f.locationId,
        userId: USER,
        type: "Make",
        asOf: "2299-01-10",
        ordered: [
          {
            itemId: f.partId,
            periodId: week1,
            quantity: 10,
            planningActionId: actionId,
            jobId
          }
        ]
      });
      expect(result.data).toEqual([
        expect.objectContaining({ id: actionId, status: "Actioned" })
      ]);
      expect(await read(overdue)).toMatchObject({ status: "Converted", jobId });
    }
  );

  databaseTest(
    "a smaller job that names a Firm planned order takes its quantity off and leaves it Firm",
    async () => {
      const firm = await plannedOrder(
        { orderType: "Make", firm: true, quantity: 100 },
        "reduce-firm"
      );
      const smaller = await job("reduce-40");
      const converted = await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(smaller, { plannedOrderId: firm, quantity: 40 })]
      });
      expect(converted).toEqual([]);
      expect(await read(firm)).toMatchObject({
        status: "Firm",
        quantity: 60,
        jobId: null,
        firmedBy: USER
      });

      // a job of all that is left converts it
      const rest = await job("reduce-60");
      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(rest, { plannedOrderId: firm, quantity: 60 })]
      });
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        quantity: 60,
        jobId: rest,
        firmedBy: null
      });
    }
  );

  databaseTest(
    "a job of the whole quantity converts the Firm planned order it names",
    async () => {
      const firm = await plannedOrder(
        { orderType: "Make", firm: true, quantity: 100 },
        "whole-firm"
      );
      const whole = await job("whole-100");
      await convertPlannedOrdersForActions(f.db, {
        companyId: f.companyId,
        userId: USER,
        documents: [document(whole, { plannedOrderId: firm, quantity: 100 })]
      });
      expect(await read(firm)).toMatchObject({
        status: "Converted",
        quantity: 100,
        jobId: whole
      });
    }
  );

  databaseTest(
    "a job with no id converts a planned order of its week by due date, not by its stored week",
    async () => {
      // stored in week 1, due in week 2: it is week 2's
      const moved = await plannedOrder(
        { orderType: "Make", dueDate: "2299-01-10" },
        "stored-week-1"
      );
      const jobId = await job("due-week-2");
      const convert = (periodId: string) =>
        convertPlannedOrdersForActions(f.db, {
          companyId: f.companyId,
          userId: USER,
          asOf: "2299-01-01",
          documents: [{ ...document(jobId), periodId }]
        });
      expect(await convert(week1)).toEqual([]);
      expect(await convert(week2)).toEqual([
        { id: moved, jobId, purchaseOrderLineId: null }
      ]);
    }
  );
});
