// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planned orders in the common segment, through `planCompany`: the parent
// item_p (Make) is built from 2 × item_c (Buy, no itemPlanning row, so it
// keeps the Phase 1 path and its demand is what the parent explodes).

import { computeJobQuantities } from "@carbon/database/job-quantities-engine";
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
import { deriveRowActions, plannedOrderActions } from "./planning-actions";

const TODAY = "2026-11-16"; // a Monday; weeks start on Sunday
const PERIODS = [
  { id: "w1", startDate: "2026-11-15", endDate: "2026-11-21" },
  { id: "w2", startDate: "2026-11-22", endDate: "2026-11-28" },
  { id: "w3", startDate: "2026-11-29", endDate: "2026-12-05" },
  { id: "w4", startDate: "2026-12-06", endDate: "2026-12-12" },
  { id: "w5", startDate: "2026-12-13", endDate: "2026-12-19" },
  { id: "w6", startDate: "2026-12-20", endDate: "2026-12-26" }
];

/** A planning row: item_p's defaults, a Make item on Demand-Based Reorder. */
const policy = (
  overrides: Partial<PlanningPolicyInput>
): PlanningPolicyInput => ({
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
  ...overrides
});

function base(
  overrides: Partial<Omit<PlanCompanyInputs, "plannedOrderInputs">> & {
    /** item_p's planning row; null leaves it out. */
    parent?: Partial<PlanningPolicyInput> | null;
    /** The planning rows of other items. */
    policies?: Partial<PlanningPolicyInput>[];
    planned?: Partial<PlannedOrderInputs>;
  } = {}
): PlanCompanyInputs {
  const { parent, policies = [], planned, ...rest } = overrides;
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
      planningPolicies: [
        ...(parent === null ? [] : [policy(parent ?? {})]),
        ...policies.map(policy)
      ],
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

/** item_p's planning row at loc_1 (`itemLocationSegmentKey`). */
const ROW = ["item_p", "loc_1", ""].join(KEY_SEP);

const key = (periodId: string, splitIndex = 0) =>
  ["item_p", "loc_1", "", "Make", periodId, String(splitIndex)].join(KEY_SEP);

/** An item's demand per week, as the run writes it to demandForecast. */
const demandOf = (outputs: PlanCompanyOutputs, itemId: string) =>
  outputs.demandForecastUpserts
    .filter((row) => row.itemId === itemId)
    .map((row) => [row.periodId, row.forecastQuantity])
    .sort();

const childDemand = (outputs: PlanCompanyOutputs) =>
  demandOf(outputs, "item_c");

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
    // a cancelled order is not offered for conversion as well
    expect(outputs.newSupplyByRow.get(ROW)).toEqual([]);
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
    // held, so the worklist keeps its Decrease
    expect(outputs.heldPlannedOrderIds).toEqual(["plo_2"]);
    expect(childDemand(outputs)).toEqual([["w3", 18]]);
  });

  // Due 2027-01-04, after the last week (w6 ends 2026-12-26): the Firm order
  // is not supply this run, so nothing needs its components yet either.
  it("does not explode a held Make order due past the horizon", () => {
    const outputs = planCompany(
      base({
        planned: {
          existingPlannedOrders: [
            heldOrder({
              id: "plo_2",
              status: "Firm",
              dueDate: "2027-01-04",
              releaseDate: "2026-12-28",
              periodId: "w8"
            })
          ]
        }
      })
    );
    expect(childDemand(outputs)).toEqual([]);
    expect(outputs.newSupplyByRow.get(ROW)).toEqual([]);
    expect(outputs.plannedOrderChangeActions).toEqual([]);
  });

  // A planner's Firm order, or a Planned one MRP holds inside the fence, is
  // a decision: when MRP stops planning the item it asks a person instead of
  // deleting the order. Not supply, not exploded.
  it.each([
    [
      "a Firm order of a deactivated item",
      { parent: { active: false } },
      heldOrder({ status: "Firm" })
    ],
    [
      "a Planned order inside the location's fence, with no planning row",
      { parent: null, locationTimeFenceDays: new Map([["loc_1", 10]]) },
      heldOrder({})
    ]
  ] as const)("keeps %s and raises a Cancel on it", (_name, setup, order) => {
    const { parent, ...planned } = setup as {
      parent: Partial<PlanningPolicyInput> | null;
      locationTimeFenceDays?: Map<string, number>;
    };
    const outputs = planCompany(
      base({
        parent,
        salesOrderLines: [sale("2026-11-30", 3)],
        planned: { ...planned, existingPlannedOrders: [order] }
      })
    );
    const cancel = {
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
    };
    expect(outputs.plannedOrderChangeActions).toEqual([cancel]);
    expect(outputs.heldPlannedOrderIds).toEqual(["plo_1"]);
    expect(outputs.plannedOrders).toEqual([]);
    // the sale's 3 explodes on the Phase 1 path; the order's 5 does not
    expect(childDemand(outputs)).toEqual([["w2", 6]]);
    // the item has no planning row this run: the Cancel still reaches the worklist
    expect(
      plannedOrderActions({
        changeActions: outputs.plannedOrderChangeActions,
        signals: outputs.plannedOrderSignals,
        newSupplyByRow: outputs.newSupplyByRow,
        plannedOrderIdByKey: new Map(),
        heldPlannedOrderIds: new Set(outputs.heldPlannedOrderIds),
        periods: PERIODS,
        todayDate: TODAY
      })
    ).toEqual([cancel]);
  });

  // Released 11-30, after the fence ends on 11-26: nothing holds it.
  it("lets a Planned order outside the fence of an item MRP no longer plans be deleted", () => {
    const outputs = planCompany(
      base({
        parent: null,
        planned: {
          locationTimeFenceDays: new Map([["loc_1", 10]]),
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
    expect(outputs.plannedOrderChangeActions).toEqual([]);
    expect(outputs.heldPlannedOrderIds).toEqual([]);
  });

  // A held order is converted through its week's Make, so it is that Make's
  // supply: its own quantity and dates, its id, and no second order for it.
  it("offers a held order for conversion as its week's Make", () => {
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
              periodId: "w4",
              quantityTrace: {
                policyName: "Fixed Reorder Quantity",
                triggerValues: { projectedStock: -3 }
              }
            })
          ]
        }
      })
    );
    expect(outputs.plannedOrders).toEqual([]);
    expect(outputs.newSupplyByRow.get(ROW)).toEqual([
      {
        type: "Make",
        periodId: "w4",
        suggestedQuantity: 8,
        suggestedDate: "2026-12-07",
        horizonDate: "2026-12-07",
        latestOrderDate: "2026-11-30",
        isASAP: false,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: "plo_2",
        plannedOrderKey: key("w4"),
        requiresManualAction: false,
        supplierId: null,
        policyName: "Fixed Reorder Quantity",
        reason: null,
        triggerValues: { projectedStock: -3 }
      }
    ]);
  });

  // The Firm 3 is due 11-20, inside its 7-day lead time, and the need of 7
  // is in the same week. A planned order is no document being made, so it
  // takes the shortfall as "Increase to 7" instead of a second Make of 4.
  it("increases a Firm order due inside its lead time", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-18", 7)],
        planned: {
          existingPlannedOrders: [
            heldOrder({
              id: "plo_2",
              status: "Firm",
              quantity: 3,
              dueDate: "2026-11-20",
              releaseDate: "2026-11-13",
              periodId: "w1"
            })
          ]
        }
      })
    );
    expect(
      (outputs.newSupplyByRow.get(ROW) ?? []).map((candidate) => [
        candidate.type,
        candidate.plannedOrderId,
        candidate.suggestedQuantity
      ])
    ).toEqual([
      ["Increase", "plo_2", 7],
      ["Make", "plo_2", 3]
    ]);
    expect(outputs.plannedOrders).toEqual([]);
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

// item_p (Make) ← 3 × item_m (Make, Pull from Inventory, with its own planning
// row) ← 2 × item_b (Buy, no planning row, a 14-day lead time).
const threeLevels = {
  items: [
    { id: "item_p", replenishmentSystem: "Make" },
    { id: "item_m", replenishmentSystem: "Make" },
    { id: "item_b", replenishmentSystem: "Buy" }
  ],
  replenishments: [
    { itemId: "item_p", leadTime: 7 },
    { itemId: "item_m", leadTime: 7 },
    { itemId: "item_b", leadTime: 14 }
  ],
  activeMethods: [
    { id: "mm_p", itemId: "item_p" },
    { id: "mm_m", itemId: "item_m" }
  ],
  materials: [
    {
      id: "mat_1",
      makeMethodId: "mm_p",
      materialMakeMethodId: null,
      itemId: "item_m",
      quantity: 3,
      methodType: "Pull from Inventory" as const
    },
    {
      id: "mat_2",
      makeMethodId: "mm_m",
      materialMakeMethodId: null,
      itemId: "item_b",
      quantity: 2,
      methodType: "Pull from Inventory" as const
    }
  ],
  policies: [{ itemId: "item_m", orderMultiple: 10 }]
};

describe("the planned-order cascade", () => {
  // item_p: a reorder point and no demand → Make 5 now. item_m needs 3 × 5 =
  // 15 plus its scrap ceil(1.5) = 2: 17, a multiple of 10 → Make 20, scrap
  // ceil(2.0) = 2, explode 22. item_b needs 2 × 22 = 44.
  it("plans a Make child from the parent's buffer order, and its bought part from the child's order", () => {
    const outputs = planCompany(
      base({
        ...threeLevels,
        parent: {
          reorderingPolicy: "Fixed Reorder Quantity",
          reorderPoint: 2,
          reorderQuantity: 5
        },
        planned: { scrapRateByItem: new Map([["item_m", 0.1]]) }
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.itemId,
        order.periodId,
        order.quantity,
        order.scrapQuantity,
        order.quantityTrace.explosionQuantity
      ])
    ).toEqual([
      ["item_p", "w1", 5, 0, 5],
      ["item_m", "w1", 20, 2, 22]
    ]);
    expect(demandOf(outputs, "item_m")).toEqual([["w1", 17]]);
    expect(demandOf(outputs, "item_b")).toEqual([["w1", 44]]);
  });

  // item_p: a need of 5 in week 4 → Make 5, released in week 3. item_m needs
  // 15 in week 3 → Make 20, released in week 2. item_b needs 40 in week 2,
  // item_m's release week: not week 1, where its own 14-day lead time puts a
  // raw need (Phase 1).
  it("dates each level's demand at the release week of the order above it", () => {
    const outputs = planCompany(
      base({ ...threeLevels, salesOrderLines: [sale("2026-12-07", 5)] })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.itemId,
        order.quantity,
        order.dueDate,
        order.releaseDate
      ])
    ).toEqual([
      ["item_p", 5, "2026-12-06", "2026-11-29"],
      ["item_m", 20, "2026-11-29", "2026-11-22"]
    ]);
    expect(demandOf(outputs, "item_m")).toEqual([["w3", 15]]);
    expect(demandOf(outputs, "item_b")).toEqual([["w2", 40]]);
  });

  // The trace is what the drawer shows: its numbers must give the order.
  it("stores a trace whose quantity, scrap and explosion give the order", () => {
    const outputs = planCompany(
      base({
        ...threeLevels,
        salesOrderLines: [sale("2026-12-07", 5)],
        planned: { scrapRateByItem: new Map([["item_m", 0.1]]) }
      })
    );
    expect(
      outputs.plannedOrders.find((order) => order.itemId === "item_m")
    ).toEqual({
      naturalKey: ["item_m", "loc_1", "", "Make", "w3", "0"].join(KEY_SEP),
      itemId: "item_m",
      locationId: "loc_1",
      planningSegmentId: "",
      orderType: "Make",
      quantity: 20,
      scrapQuantity: 2,
      dueDate: "2026-11-29",
      releaseDate: "2026-11-22",
      periodId: "w3",
      splitIndex: 0,
      lowLevelCode: 1,
      supplierId: null,
      quantityTrace: {
        policyName: "Demand-Based Reorder",
        // 15 + 2 scrap short
        triggerValues: {
          projectedStock: -17,
          safetyStock: 0,
          lotSize: 0,
          leadTime: 7
        },
        quantity: 20,
        scrapQuantity: 2,
        explosionQuantity: 22
      }
    });
  });
});

describe("explosion parity with job creation", () => {
  const scrapRates = new Map([
    ["item_p", 0.1],
    ["item_m", 0.15],
    ["item_c", 0.15]
  ]);
  /** What job creation puts on a job of `quantity` item_p, by node id. */
  const jobQuantities = (
    quantity: number,
    child: { itemId: string; quantity: number; methodType: string },
    grandchild?: { itemId: string; quantity: number; methodType: string }
  ) =>
    new Map(
      computeJobQuantities({
        tree: {
          id: "job",
          data: {
            isRoot: true,
            itemId: "item_p",
            quantity: 1,
            methodType: "Make"
          },
          children: [
            {
              id: "child",
              data: { isRoot: false, ...child },
              children: grandchild
                ? [{ id: "grandchild", data: { isRoot: false, ...grandchild } }]
                : []
            }
          ]
        },
        parentEstimatedQuantity: quantity,
        storedScrapById: new Map(),
        replenishmentScrapByItemId: scrapRates
      }).computed.map((node) => [node.id, node.estimatedQuantity])
    );

  // A job of 10 item_p makes 10 + ceil(1.0) = 11. item_c needs 2 × 11 = 22
  // plus its own scrap ceil(3.3) = 4: 26.
  it("gives a bought child the material quantity of a job for the same order", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-30", 10)],
        planned: { scrapRateByItem: scrapRates }
      })
    );
    expect(childDemand(outputs)).toEqual([["w2", 26]]);
    expect(
      jobQuantities(10, {
        itemId: "item_c",
        quantity: 2,
        methodType: "Pull from Inventory"
      }).get("child")
    ).toBe(26);
  });

  // item_m is built inside item_p's job (Make to Order): its subjob makes
  // 2 × 11 = 22 plus its scrap ceil(3.3) = 4, so the subjob needs 3 × 26 =
  // 78 of item_b. item_m takes the raw-need path, which adds its scrap.
  it("gives the part under a Make to Order child the material quantity of the child's subjob", () => {
    const outputs = planCompany(
      base({
        items: [
          { id: "item_p", replenishmentSystem: "Make" },
          { id: "item_m", replenishmentSystem: "Make" },
          { id: "item_b", replenishmentSystem: "Buy" }
        ],
        activeMethods: [
          { id: "mm_p", itemId: "item_p" },
          { id: "mm_m", itemId: "item_m" }
        ],
        materials: [
          {
            id: "mat_1",
            makeMethodId: "mm_p",
            materialMakeMethodId: "mm_m",
            itemId: "item_m",
            quantity: 2,
            methodType: "Make to Order"
          },
          {
            id: "mat_2",
            makeMethodId: "mm_m",
            materialMakeMethodId: null,
            itemId: "item_b",
            quantity: 3,
            methodType: "Pull from Inventory"
          }
        ],
        salesOrderLines: [sale("2026-11-30", 10)],
        planned: { scrapRateByItem: scrapRates }
      })
    );
    const job = jobQuantities(
      10,
      { itemId: "item_m", quantity: 2, methodType: "Make to Order" },
      { itemId: "item_b", quantity: 3, methodType: "Pull from Inventory" }
    );
    expect([job.get("child"), job.get("grandchild")]).toEqual([22, 78]);
    expect(demandOf(outputs, "item_m")).toEqual([]);
    expect(demandOf(outputs, "item_b")).toEqual([["w1", 78]]);
  });
});

describe("buffer policies", () => {
  // Projected 0, no demand. Maximum Quantity orders up to its maximum 8 once
  // under the reorder point 2; Fixed Reorder Quantity orders its 5.
  it.each([
    [
      "Maximum Quantity",
      { reorderPoint: 2, reorderQuantity: 1, maximumInventoryQuantity: 8 },
      [8],
      [["w1", 16]]
    ],
    [
      "Fixed Reorder Quantity",
      { reorderPoint: 2, reorderQuantity: 5 },
      [5],
      [["w1", 10]]
    ]
  ] as const)(
    "%s plans an order with no demand and explodes it",
    (reorderingPolicy, parent, quantities, demand) => {
      const outputs = planCompany(
        base({ parent: { reorderingPolicy, ...parent } })
      );
      expect(
        outputs.plannedOrders.map((order) => [
          order.quantity,
          order.quantityTrace.policyName
        ])
      ).toEqual(quantities.map((quantity) => [quantity, reorderingPolicy]));
      expect(childDemand(outputs)).toEqual(demand);
    }
  );

  // The planning RPCs give these items no row without demand or supply, so
  // MRP plans nothing for them either.
  it.each([
    ["Demand-Based Reorder", { demandAccumulationSafetyStock: 3 }],
    ["Manual Reorder", { reorderPoint: 2, reorderQuantity: 5 }]
  ] as const)(
    "%s plans no order with no demand",
    (reorderingPolicy, parent) => {
      const outputs = planCompany(
        base({ parent: { reorderingPolicy, ...parent } })
      );
      expect(outputs.plannedOrders).toEqual([]);
      expect(childDemand(outputs)).toEqual([]);
    }
  );
});

describe("planned orders across runs", () => {
  // Configured items hold every configuration's lines at quantity 0 except
  // the default's.
  it("never gives demand to a quantity-0 BOM line", () => {
    const outputs = planCompany(
      base({
        items: [
          { id: "item_p", replenishmentSystem: "Make" },
          { id: "item_c", replenishmentSystem: "Buy" },
          { id: "item_x", replenishmentSystem: "Buy" }
        ],
        materials: [
          {
            id: "mat_1",
            makeMethodId: "mm_p",
            materialMakeMethodId: null,
            itemId: "item_c",
            quantity: 2,
            methodType: "Pull from Inventory"
          },
          {
            id: "mat_2",
            makeMethodId: "mm_p",
            materialMakeMethodId: null,
            itemId: "item_x",
            quantity: 0,
            methodType: "Pull from Inventory"
          }
        ],
        salesOrderLines: [sale("2026-11-30", 3)]
      })
    );
    expect(outputs.plannedOrders.map((order) => order.quantity)).toEqual([3]);
    expect(childDemand(outputs)).toEqual([["w2", 6]]);
    expect(demandOf(outputs, "item_x")).toEqual([]);
  });

  // Run 1 raises the Cancel; applying it deletes the order. With nothing
  // needing the item, run 2 plans no order and raises no action again.
  it("does not plan a cancelled order again", () => {
    const parent = {
      planningTimeFenceDays: 14,
      demandAccumulationSafetyStock: 0
    };
    const first = planCompany(
      base({ parent, planned: { existingPlannedOrders: [heldOrder({})] } })
    );
    expect(
      first.plannedOrderChangeActions.map((action) => [
        action.type,
        action.plannedOrderId
      ])
    ).toEqual([["Cancel", "plo_1"]]);

    const next = planCompany(
      base({ parent, planned: { existingPlannedOrders: [] } })
    );
    expect(next.plannedOrders).toEqual([]);
    expect(next.plannedOrderChangeActions).toEqual([]);
    expect(next.heldPlannedOrderIds).toEqual([]);
    expect(childDemand(next)).toEqual([]);
  });

  // The location fence is 10 days. Needed on 11-22 with a 7-day lead time,
  // a new order would start on 11-15; the Planned order released on 11-20 is
  // inside 10 days.
  it.each([
    [
      "an explicit item fence of 0 opts out of the location's",
      0,
      { order: [key("w2"), "2026-11-22", "2026-11-15"], held: [] }
    ],
    [
      "a missing item fence takes the location's",
      null,
      { order: [key("w3"), "2026-12-03", "2026-11-26"], held: ["plo_1"] }
    ]
  ] as const)("%s", (_name, planningTimeFenceDays, expected) => {
    const outputs = planCompany(
      base({
        parent: { planningTimeFenceDays },
        salesOrderLines: [sale("2026-11-22", 4)],
        planned: {
          locationTimeFenceDays: new Map([["loc_1", 10]]),
          existingPlannedOrders: [
            heldOrder({
              quantity: 1,
              dueDate: "2026-12-11",
              releaseDate: "2026-11-20",
              periodId: "w4"
            })
          ]
        }
      })
    );
    expect(
      outputs.plannedOrders.map((order) => [
        order.naturalKey,
        order.dueDate,
        order.releaseDate
      ])
    ).toEqual([expected.order]);
    expect(outputs.heldPlannedOrderIds).toEqual(expected.held);
  });

  // The planned order became job_1 (Converted): the run no longer loads it,
  // and the job is open supply. Its need of 10 is covered once — no new
  // order, no change on the job — and the job's own material is the child's
  // only demand.
  it("counts a converted order once, as its job", () => {
    const outputs = planCompany(
      base({
        salesOrderLines: [sale("2026-11-30", 10)],
        productionLines: [
          {
            id: "job_1",
            itemId: "item_p",
            locationId: "loc_1",
            quantityToReceive: 10,
            dueDate: "2026-11-30",
            deadlineType: "Hard Deadline"
          }
        ],
        jobMaterialLines: [
          {
            jobId: "job_1",
            itemId: "item_c",
            locationId: "loc_1",
            dueDate: "2026-11-30",
            leadTime: 7,
            quantityPerParent: 2,
            quantityToIssue: 20
          }
        ],
        planned: {
          openSupplyOrders: new Map([
            [
              ["item_p", "loc_1", ""].join(KEY_SEP),
              [
                {
                  jobId: "job_1",
                  quantity: 10,
                  dueDate: "2026-11-30",
                  requiresManualAction: false,
                  release: null
                }
              ]
            ]
          ])
        }
      })
    );
    expect(outputs.plannedOrders).toEqual([]);
    expect(outputs.plannedOrderChangeActions).toEqual([]);
    expect(
      outputs.newSupplyByRow.get(["item_p", "loc_1", ""].join(KEY_SEP))
    ).toEqual([]);
    expect(childDemand(outputs)).toEqual([]);
    expect(
      outputs.demandActualUpserts
        .filter((row) => row.itemId === "item_c")
        .map((row) => [row.periodId, row.actualQuantity])
    ).toEqual([["w2", 20]]);
  });
});
