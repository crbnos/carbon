// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planned orders in the common segment, through `planCompany`: the parent
// item_p (Make) is built from 2 × item_c (Buy, no itemPlanning row, so it
// keeps the Phase 1 path and its demand is what the parent explodes).

import { KEY_SEP } from "@carbon/database/mrp-engine";
import { describe, expect, it } from "vitest";
import {
  type PlanCompanyInputs,
  type PlanCompanyOutputs,
  planCompany
} from "./plan-company";
import {
  createPlanSupply,
  type ExistingPlannedOrder,
  type PlannedOrderInputs,
  type PlanningPolicyInput
} from "./planned-orders";
import { deriveRowActions } from "./planning-actions";

const TODAY = "2026-11-16"; // a Monday; weeks start on Sunday
const PERIODS = [
  { id: "w1", startDate: "2026-11-15", endDate: "2026-11-21" },
  { id: "w2", startDate: "2026-11-22", endDate: "2026-11-28" },
  { id: "w3", startDate: "2026-11-29", endDate: "2026-12-05" },
  { id: "w4", startDate: "2026-12-06", endDate: "2026-12-12" },
  { id: "w5", startDate: "2026-12-13", endDate: "2026-12-19" },
  { id: "w6", startDate: "2026-12-20", endDate: "2026-12-26" }
];

function base(
  overrides: Partial<Omit<PlanCompanyInputs, "plannedOrderInputs">> & {
    /** item_p's planning row; null leaves it out. */
    parent?: Partial<PlanningPolicyInput> | null;
    planned?: Partial<PlannedOrderInputs>;
  } = {}
): PlanCompanyInputs {
  const { parent, planned, ...rest } = overrides;
  const parentPolicy: PlanningPolicyInput = {
    itemId: "item_p",
    locationId: "loc_1",
    active: true,
    itemTrackingType: "Inventory",
    replenishmentSystem: "Make",
    reorderingPolicy: "Demand-Based Reorder",
    reorderPoint: 0,
    reorderQuantity: 0,
    minimumOrderQuantity: 0,
    maximumOrderQuantity: 0,
    orderMultiple: 0,
    lotSize: 0,
    maximumInventoryQuantity: 0,
    demandAccumulationPeriod: 1,
    demandAccumulationSafetyStock: 0,
    leadTime: 7,
    planningTimeFenceDays: null,
    ...parent
  };
  return {
    companyId: "co_1",
    userId: "system",
    today: TODAY,
    periods: PERIODS,
    locationIds: ["loc_1"],
    consumptionWindow: { backwardPeriods: 0, forwardPeriods: 0 },
    salesOrderLines: [],
    jobMaterialLines: [],
    productionLines: [],
    purchaseOrderLines: [],
    demandProjections: [],
    items: [
      { id: "item_p", replenishmentSystem: "Make" },
      { id: "item_c", replenishmentSystem: "Buy" }
    ],
    replenishments: [
      { itemId: "item_p", leadTime: 7 },
      { itemId: "item_c", leadTime: 7 }
    ],
    supersessions: [],
    onHand: [],
    activeMethods: [{ id: "mm_p", itemId: "item_p" }],
    materials: [
      {
        id: "mat_1",
        makeMethodId: "mm_p",
        materialMakeMethodId: null,
        itemId: "item_c",
        quantity: 2,
        methodType: "Pull from Inventory"
      }
    ],
    existingDemandActuals: [],
    existingSupplyActuals: [],
    ...rest,
    plannedOrderInputs: {
      planningPolicies: parent === null ? [] : [parentPolicy],
      locationTimeFenceDays: new Map(),
      scrapRateByItem: new Map(),
      preferredSupplierByItem: new Map(),
      openSupplyOrders: new Map(),
      existingPlannedOrders: [],
      toleranceDays: 7,
      ...planned
    }
  };
}

const sale = (promisedDate: string, quantity: number, id = "sol_1") => ({
  id,
  itemId: "item_p",
  locationId: "loc_1",
  promisedDate,
  quantityToSend: quantity,
  quantityToConsume: quantity
});

const heldOrder = (
  overrides: Partial<ExistingPlannedOrder>
): ExistingPlannedOrder => ({
  id: "plo_1",
  itemId: "item_p",
  locationId: "loc_1",
  planningSegmentId: "",
  orderType: "Make",
  status: "Planned",
  quantity: 5,
  scrapQuantity: 0,
  dueDate: "2026-11-27",
  releaseDate: "2026-11-20",
  periodId: "w2",
  splitIndex: 0,
  supplierId: null,
  ...overrides
});

const key = (periodId: string, splitIndex = 0) =>
  ["item_p", "loc_1", "", "Make", periodId, String(splitIndex)].join(KEY_SEP);

/** item_c's demand per week, as the run writes it to demandForecast. */
const childDemand = (outputs: PlanCompanyOutputs) =>
  outputs.demandForecastUpserts
    .filter((row) => row.itemId === "item_c")
    .map((row) => [row.periodId, row.forecastQuantity])
    .sort();

describe("planned orders in planCompany", () => {
  // Projected 0 is under the reorder point 2: one fixed order of 5, due now.
  it("plans a buffer need with no demand and explodes it to the child", () => {
    const outputs = planCompany(
      base({
        parent: {
          reorderingPolicy: "Fixed Reorder Quantity",
          reorderPoint: 2,
          reorderQuantity: 5
        }
      })
    );
    expect(outputs.plannedOrders).toEqual([
      {
        naturalKey: key("w1"),
        itemId: "item_p",
        locationId: "loc_1",
        planningSegmentId: "",
        orderType: "Make",
        quantity: 5,
        scrapQuantity: 0,
        dueDate: "2026-11-15",
        releaseDate: "2026-11-08",
        periodId: "w1",
        splitIndex: 0,
        lowLevelCode: 0,
        supplierId: null,
        quantityTrace: {
          policyName: "Fixed Reorder Quantity",
          triggerValues: {
            projectedStock: 0,
            reorderPoint: 2,
            reorderQuantity: 5,
            leadTime: 7
          },
          quantity: 5,
          scrapQuantity: 0,
          explosionQuantity: 5
        }
      }
    ]);
    expect(childDemand(outputs)).toEqual([["w1", 10]]);
  });

  // Need 3 in week 3 rounds up to the multiple of 5; the surplus 2 covers
  // week 4's need of 2. The child gets 5 × 2 in the release week (week 2).
  it("explodes the lot-sized quantity at the release week, and plans the surplus as stock", () => {
    const outputs = planCompany(
      base({
        parent: { orderMultiple: 5 },
        salesOrderLines: [sale("2026-11-30", 3), sale("2026-12-07", 2, "sol_2")]
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.periodId,
        order.quantity,
        order.dueDate,
        order.releaseDate
      ])
    ).toEqual([["w3", 5, "2026-11-29", "2026-11-22"]]);
    expect(childDemand(outputs)).toEqual([["w2", 10]]);
  });

  // 10 × 0.1 = 1 unit of scrap: the job makes 11, so the child needs 22.
  it("explodes the parent's scrap with the order", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-30", 10)],
        planned: { scrapRateByItem: new Map([["item_p", 0.1]]) }
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.quantity,
        order.scrapQuantity,
        order.quantityTrace.explosionQuantity
      ])
    ).toEqual([[10, 1, 11]]);
    expect(childDemand(outputs)).toEqual([["w2", 22]]);
  });

  // Needed on day 6 with a 7-day lead time, it should have started already.
  // The location's 10-day fence starts it on day 10 and moves its due date
  // the same 11 days; the Expedite keeps the real need date.
  it("starts a new order at the end of the time fence and signals the real need date", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-22", 4)],
        planned: { locationTimeFenceDays: new Map([["loc_1", 10]]) }
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.naturalKey,
        order.dueDate,
        order.releaseDate
      ])
    ).toEqual([[key("w3"), "2026-12-03", "2026-11-26"]]);
    expect(outputs.plannedOrderSignals).toEqual([
      { naturalKey: key("w3"), expediteTo: "2026-11-22" }
    ]);
    expect(childDemand(outputs)).toEqual([["w2", 8]]);
  });

  // Released inside the item's 14-day fence, the Planned order is held:
  // nothing needs it, so it gets a Cancel instead of a silent delete.
  it("cancels a held planned order nothing needs, and still explodes it", () => {
    const outputs = planCompany(
      base({
        parent: { planningTimeFenceDays: 14 },
        planned: { existingPlannedOrders: [heldOrder({})] }
      })
    );
    expect(outputs.plannedOrderChangeActions).toEqual([
      {
        itemId: "item_p",
        locationId: "loc_1",
        planningSegmentId: "",
        type: "Cancel",
        periodId: "w2",
        suggestedQuantity: 5,
        suggestedDate: "2026-11-27",
        horizonDate: "2026-11-27",
        latestOrderDate: null,
        isASAP: false,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: "plo_1",
        requiresManualAction: false,
        supplierId: null,
        policyName: null,
        reason: expect.any(String),
        triggerValues: null
      }
    ]);
    expect(outputs.heldPlannedOrderIds).toEqual(["plo_1"]);
    expect(outputs.plannedOrders).toEqual([]);
    expect(childDemand(outputs)).toEqual([["w1", 10]]);
  });

  // The Firm 8 (+1 scrap) covers the need of 3: MRP suggests a Decrease, but
  // the order keeps its quantity, explodes in full and needs no new order.
  it("keeps a Firm order's quantity and explodes it in full", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-12-07", 3)],
        planned: {
          existingPlannedOrders: [
            heldOrder({
              id: "plo_2",
              status: "Firm",
              quantity: 8,
              scrapQuantity: 1,
              dueDate: "2026-12-07",
              releaseDate: "2026-11-30",
              periodId: "w4"
            })
          ]
        }
      })
    );
    expect(
      outputs.plannedOrderChangeActions.map((action) => [
        action.type,
        action.plannedOrderId,
        action.suggestedQuantity
      ])
    ).toEqual([["Decrease", "plo_2", 3]]);
    expect(outputs.plannedOrders).toEqual([]);
    expect(outputs.heldPlannedOrderIds).toEqual([]);
    expect(childDemand(outputs)).toEqual([["w3", 18]]);
  });

  // On-hand 2, needs of 5 (week 2) and 3 (week 4), multiples of 4. The
  // planning RPC's week columns for this row are 2, -3, -3, -6, -6, -6.
  it("sizes the same Make quantities as the planning worklist with no fence", () => {
    const outputs = planCompany(
      base({
        parent: { orderMultiple: 4 },
        onHand: [{ itemId: "item_p", locationId: "loc_1", quantityOnHand: 2 }],
        salesOrderLines: [sale("2026-11-23", 5), sale("2026-12-08", 3, "sol_2")]
      })
    );
    const worklist = deriveRowActions({
      row: {
        id: "item_p",
        planningSegmentId: "",
        reorderingPolicy: "Demand-Based Reorder",
        reorderPoint: 0,
        reorderQuantity: 0,
        minimumOrderQuantity: 0,
        maximumOrderQuantity: 0,
        orderMultiple: 4,
        lotSize: 0,
        maximumInventoryQuantity: 0,
        demandAccumulationPeriod: 1,
        demandAccumulationSafetyStock: 0,
        leadTime: 7,
        quantityOnHand: 2,
        quantityToOrder: 8,
        supersessionMode: null,
        minimumReserveQuantity: 0,
        week1: 2,
        week2: -3,
        week3: -3,
        week4: -6,
        week5: -6,
        week6: -6
      } as unknown as Parameters<typeof deriveRowActions>[0]["row"],
      kind: "Make",
      periods: PERIODS,
      demandByPeriod: new Map([
        ["w2", 5],
        ["w4", 3]
      ]),
      openOrders: [],
      onHand: 2,
      draws: [],
      toleranceDays: 7,
      todayDate: TODAY
    });
    const quantities = (
      actions: { type: string; periodId: string; suggestedQuantity: number }[]
    ) => actions.map((a) => [a.type, a.periodId, a.suggestedQuantity]);
    expect(quantities(worklist)).toEqual([
      ["Make", "w2", 4],
      ["Make", "w4", 4]
    ]);
    expect(
      quantities(
        outputs.newSupplyByRow.get(["item_p", "loc_1", ""].join(KEY_SEP)) ?? []
      )
    ).toEqual(quantities(worklist));
    expect(outputs.plannedOrders.map((order) => order.quantity)).toEqual([
      4, 4
    ]);
  });

  // No itemPlanning row at the location: the worklist has no row for it, so
  // the raw need of 3 explodes a week early, as before.
  it("keeps the Phase 1 explosion for an item with no planning row", () => {
    const outputs = planCompany(
      base({ parent: null, salesOrderLines: [sale("2026-11-30", 3)] })
    );
    expect(outputs.plannedOrders).toEqual([]);
    expect(outputs.newSupplyByRow.size).toBe(0);
    expect(childDemand(outputs)).toEqual([["w2", 6]]);
  });

  // A No Stock item gets no worklist row, and no buffer order either.
  it("plans no order for a superseded item", () => {
    const outputs = planCompany(
      base({
        parent: {
          reorderingPolicy: "Fixed Reorder Quantity",
          reorderPoint: 2,
          reorderQuantity: 5
        },
        supersessions: [
          {
            itemId: "item_p",
            supersessionMode: "No Stock",
            successorItemId: null,
            successorEffectivityDate: null,
            conversionFactor: null
          }
        ]
      })
    );
    expect(outputs.plannedOrders).toEqual([]);
    expect(childDemand(outputs)).toEqual([]);
  });

  // A Make to Order child is built inside its parent's job: it gets no
  // planned order, and its need passes through to its own children.
  it("plans no order for a child built as Make to Order", () => {
    const outputs = planCompany(
      base({
        parent: { itemId: "item_c", replenishmentSystem: "Make" },
        items: [
          { id: "item_p", replenishmentSystem: "Make" },
          { id: "item_c", replenishmentSystem: "Make" }
        ],
        materials: [
          {
            id: "mat_1",
            makeMethodId: "mm_p",
            materialMakeMethodId: "mm_c",
            itemId: "item_c",
            quantity: 2,
            methodType: "Make to Order"
          }
        ],
        salesOrderLines: [sale("2026-11-30", 3)]
      })
    );
    expect(outputs.plannedOrders).toEqual([]);
  });

  // The job of 4 lands within the tolerance of the need of 7, so the
  // shortfall of 3 becomes "Increase to 7". The extra 3 needs components
  // from the job's start (due 12-01 less 7 days: week 2).
  it("explodes the extra quantity of an Increase on an open job", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-30", 7)],
        productionLines: [
          {
            id: "job_1",
            itemId: "item_p",
            locationId: "loc_1",
            quantityToReceive: 4,
            dueDate: "2026-12-01",
            deadlineType: "Hard Deadline"
          }
        ],
        planned: {
          openSupplyOrders: new Map([
            [
              ["item_p", "loc_1", ""].join(KEY_SEP),
              [
                {
                  jobId: "job_1",
                  quantity: 4,
                  dueDate: "2026-12-01",
                  requiresManualAction: false,
                  release: null
                }
              ]
            ]
          ])
        }
      })
    );
    expect(
      (
        outputs.newSupplyByRow.get(["item_p", "loc_1", ""].join(KEY_SEP)) ?? []
      ).map((a) => [a.type, a.jobId, a.suggestedQuantity])
    ).toEqual([["Increase", "job_1", 7]]);
    expect(outputs.plannedOrders).toEqual([]);
    expect(childDemand(outputs)).toEqual([["w2", 6]]);
  });

  // The held Planned row owns split 0 of week 4, so the new order of the
  // same week takes split 1 and never overwrites it.
  it("gives a new order a split index a held Planned order does not use", () => {
    const outputs = planCompany(
      base({
        parent: { lotSize: 7, planningTimeFenceDays: 14 },
        salesOrderLines: [sale("2026-12-07", 12)],
        planned: {
          existingPlannedOrders: [
            heldOrder({
              dueDate: "2026-12-07",
              releaseDate: "2026-11-30",
              periodId: "w4"
            })
          ]
        }
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.naturalKey,
        order.quantity,
        order.dueDate
      ])
    ).toEqual([[key("w4", 1), 7, "2026-12-07"]]);
    expect(outputs.heldPlannedOrderIds).toEqual(["plo_1"]);
  });

  it("leaves a project segment to the Phase 1 path", () => {
    const { planSupply } = createPlanSupply({
      ...base().plannedOrderInputs!,
      todayDate: TODAY,
      periods: PERIODS,
      supersededItemIds: new Set(),
      inlineProductionItemIds: new Set()
    });
    expect(
      planSupply({
        locationId: "loc_1",
        itemId: "item_p",
        segmentId: "prj_1",
        grossByPeriod: [0, 0, 3, 0, 0, 0],
        supplyByPeriod: [0, 0, 0, 0, 0, 0],
        onHand: 0
      })
    ).toBeNull();
  });
});
