// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Planning's Make / Order settles the Make / Order actions it answers, and in
// the same transaction converts the planned orders those actions cover: each
// job or PO line placed against an action is linked to the action's next
// Planned or Firm planned order of its week, in splitIndex order.

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
        quantity: 10,
        dueDate: "2299-01-05",
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

async function read(id: string) {
  return f.db
    .selectFrom("plannedOrder")
    .select([
      "status",
      "jobId",
      "purchaseOrderLineId",
      "firmedBy",
      "updatedBy"
    ])
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
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
        settled: [
          {
            itemId: f.partId,
            locationId: f.locationId,
            planningSegmentId: "",
            periodId: week1,
            orderType: "Make",
            documentIds: [jobId]
          }
        ]
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
          settled: [
            {
              itemId: f.partId,
              locationId: f.locationId,
              planningSegmentId: "",
              periodId: week1,
              orderType: "Make",
              documentIds: [documentId]
            }
          ]
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
});
