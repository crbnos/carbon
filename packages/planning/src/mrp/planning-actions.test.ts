// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { computePlanningOrders } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import type {
  ExistingPlanningAction,
  PlanningActionCandidate
} from "./planning-actions";
import {
  convertOrdersToIncreases,
  daysBetween,
  deriveChangeActions,
  deriveReleaseActions,
  diffPlanningActions,
  earlierDate,
  earlierRelease,
  firstNeedPeriodByOrder,
  isCommittedJobStatus,
  isCommittedPurchaseOrderStatus,
  isOrderFrozen,
  keyPeriodFor,
  naturalKey,
  projectionsWithExpedites,
  releaseByDate
} from "./planning-actions";

const PERIODS = [
  { id: "p1", startDate: "2026-10-05" },
  { id: "p2", startDate: "2026-10-12" },
  { id: "p3", startDate: "2026-10-19" },
  { id: "p4", startDate: "2026-10-26" },
  { id: "p5", startDate: "2026-11-02" }
];

const TODAY = "2026-09-11";
const TOLERANCE = 7;

const base = {
  periods: PERIODS,
  policyFloor: 0,
  toleranceDays: TOLERANCE,
  todayDate: TODAY
};

describe("daysBetween", () => {
  it("returns the signed day difference (pins CalendarDate.compare semantics)", () => {
    expect(daysBetween("2026-10-12", "2026-10-05")).toBe(7);
    expect(daysBetween("2026-10-05", "2026-10-12")).toBe(-7);
    expect(daysBetween("2026-10-05", "2026-10-05")).toBe(0);
  });
});

describe("earlierDate", () => {
  it("returns the earlier of two ISO dates, either way round", () => {
    expect(earlierDate("2026-10-05", "2026-10-26")).toBe("2026-10-05");
    expect(earlierDate("2026-10-26", "2026-10-05")).toBe("2026-10-05");
    expect(earlierDate("2026-10-05", "2026-10-05")).toBe("2026-10-05");
  });
});

describe("commitment gates", () => {
  it("PO: Draft and Planned are NOT committed; sent statuses are", () => {
    expect(isCommittedPurchaseOrderStatus("Draft")).toBe(false);
    expect(isCommittedPurchaseOrderStatus("Planned")).toBe(false);
    for (const status of [
      "To Receive",
      "To Receive and Invoice",
      "To Invoice",
      "Completed",
      "Closed"
    ] as const) {
      expect(isCommittedPurchaseOrderStatus(status)).toBe(true);
    }
  });

  it("job: Ready and later are committed; Draft/Planned are not", () => {
    expect(isCommittedJobStatus("Draft")).toBe(false);
    expect(isCommittedJobStatus("Planned")).toBe(false);
    expect(isCommittedJobStatus("Ready")).toBe(true);
    expect(isCommittedJobStatus("In Progress")).toBe(true);
    expect(isCommittedJobStatus("Paused")).toBe(true);
  });
});

describe("deriveChangeActions", () => {
  it("raises Expedite when an open PO lands more than the tolerance after its requirement", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-26", // 21 days after the need
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Expedite",
      purchaseOrderLineId: "pol-1",
      suggestedDate: "2026-10-05",
      // inside a fence from the day it is NEEDED, not the day it lands
      horizonDate: "2026-10-05",
      latestOrderDate: null,
      periodId: "p1",
      suggestedQuantity: 10
    });
  });

  it("suppresses a date gap at exactly the tolerance and fires at tolerance + 1 (strict >)", () => {
    const make = (dueDate: string) =>
      deriveChangeActions({
        ...base,
        onHand: 0,
        demandPeriods: [
          { periodId: "p1", startDate: "2026-10-05", quantity: 5 }
        ],
        openOrders: [
          {
            purchaseOrderLineId: "pol-1",
            quantity: 5,
            dueDate,
            requiresManualAction: false
          }
        ]
      });

    // gap of exactly 7 days → no message
    expect(make("2026-10-12")).toEqual([]);
    // gap of 8 days → Expedite
    expect(make("2026-10-13").map((a) => a.type)).toEqual(["Expedite"]);
  });

  it("raises Defer when an order lands more than the tolerance before its requirement", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [{ periodId: "p4", startDate: "2026-10-26", quantity: 5 }],
      openOrders: [
        {
          jobId: "job-1",
          quantity: 5,
          dueDate: "2026-10-05", // 21 days early
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Defer",
      jobId: "job-1",
      suggestedDate: "2026-10-26",
      // inside a fence from where the order sits TODAY — deferring it is a
      // near-term decision even though the requirement is weeks out
      horizonDate: "2026-10-05",
      latestOrderDate: null,
      periodId: "p4"
    });
  });

  it("gives no verdict on an order due after the last planning week", () => {
    // PERIODS ends with the week of 2026-11-02. Demand beyond it is not
    // loaded, so an order out there is not "unneeded" — it is unjudged.
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [],
      openOrders: [
        {
          purchaseOrderLineId: "pol-far",
          quantity: 25,
          dueDate: "2026-11-09", // first day past the horizon
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  it("still judges an order due on the last day of the last planning week", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [],
      openOrders: [
        {
          purchaseOrderLineId: "pol-edge",
          quantity: 25,
          dueDate: "2026-11-08",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toMatchObject([
      { type: "Cancel", purchaseOrderLineId: "pol-edge" }
    ]);
  });

  it("does not pull an order from beyond the horizon in to cover an earlier need", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-far",
          quantity: 10,
          dueDate: "2026-12-14",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  it("raises Cancel for an order with no remaining requirement", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 100, // on-hand covers all demand
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 25,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Cancel",
      purchaseOrderLineId: "pol-1",
      suggestedQuantity: 25
    });
  });

  it("raises Decrease for the unneeded tail of a partially required order", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [{ periodId: "p2", startDate: "2026-10-12", quantity: 6 }],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12", // on time → no date action
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Decrease",
      suggestedQuantity: 6 // decrease TO the required amount
    });
  });

  it("does not raise Decrease when fractional demand consumes the order exactly", () => {
    // 0.7 + 0.1 is 0.7999999999999999 in floats; the raw leftover would be
    // ~1e-16 and read as an unneeded tail of a fully required order.
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 0.7 },
        { periodId: "p2", startDate: "2026-10-12", quantity: 0.1 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 0.8,
          dueDate: "2026-10-05", // on time → no date action
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  it("emits exactly ONE action per target — a date problem beats a quantity problem", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [{ periodId: "p1", startDate: "2026-10-05", quantity: 6 }],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10, // wrong qty AND
          dueDate: "2026-10-26", // wrong date (21 days late)
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("Expedite");
  });

  it("never cancels stock held for the policy floor (safety stock)", () => {
    const actions = deriveChangeActions({
      ...base,
      policyFloor: 25, // safety stock justifies the order
      onHand: 0,
      demandPeriods: [],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 25,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  // The floor used to take what the demand walk left, undated: an order
  // holding safety stock was dated by a later demand and offered a Defer, and
  // applying it put stock under the floor until that date.
  it("never defers an order that holds the policy floor", () => {
    const actions = deriveChangeActions({
      ...base,
      policyFloor: 10,
      onHand: 0,
      demandPeriods: [
        { periodId: "p5", startDate: "2026-11-02", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 20,
          dueDate: "2026-10-05",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  it("holds the floor with the earliest order and defers the later one", () => {
    const actions = deriveChangeActions({
      ...base,
      policyFloor: 10,
      onHand: 0,
      demandPeriods: [
        { periodId: "p5", startDate: "2026-11-02", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-b",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        },
        {
          purchaseOrderLineId: "pol-a",
          quantity: 10,
          dueDate: "2026-10-05",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Defer",
      purchaseOrderLineId: "pol-b",
      suggestedDate: "2026-11-02"
    });
  });

  it("carries requiresManualAction from the committed target", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 100,
      demandPeriods: [],
      openOrders: [
        {
          purchaseOrderLineId: "pol-sent",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: true
        }
      ]
    });
    expect(actions[0]).toMatchObject({
      type: "Cancel",
      requiresManualAction: true
    });
  });

  // An overdue order arrives today at the earliest. Measured from its old due
  // date it read as early and was offered a Defer to a date already past.
  it("raises nothing for an overdue order that is needed now", () => {
    const actions = deriveChangeActions({
      ...base,
      todayDate: "2026-10-07",
      onHand: 0,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-09-23", // two weeks late
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toEqual([]);
  });

  it("measures an overdue order's Defer from today, never to a past date", () => {
    const actions = deriveChangeActions({
      ...base,
      todayDate: "2026-10-07",
      onHand: 0,
      demandPeriods: [
        { periodId: "p4", startDate: "2026-10-26", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-09-23",
          requiresManualAction: false
        }
      ]
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Defer",
      suggestedDate: "2026-10-26",
      reason: "Not needed until 19 days after its current date"
    });
  });

  // Apply moves a PO line's required date; a supplier's promised date
  // outranks it, so applying a date change there moved nothing and the same
  // action came back every run.
  it("sends a date change on a promised line to the PO for review", () => {
    const promised = (dueDate: string, needStart: string, periodId: string) =>
      deriveChangeActions({
        ...base,
        onHand: 0,
        demandPeriods: [{ periodId, startDate: needStart, quantity: 10 }],
        openOrders: [
          {
            purchaseOrderLineId: "pol-1",
            quantity: 10,
            dueDate,
            requiresManualAction: false,
            dateIsPromised: true
          }
        ]
      });

    expect(promised("2026-10-26", "2026-10-05", "p1")[0]).toMatchObject({
      type: "Expedite",
      requiresManualAction: true
    });
    expect(promised("2026-10-05", "2026-10-26", "p4")[0]).toMatchObject({
      type: "Defer",
      requiresManualAction: true
    });
  });

  it("still lets a promised line's quantity be changed", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 100,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-05",
          requiresManualAction: false,
          dateIsPromised: true
        }
      ]
    });
    expect(actions[0]).toMatchObject({
      type: "Cancel",
      requiresManualAction: false
    });
  });

  // Apply changes a PO line in whole PURCHASE units (it writes
  // round(suggested / conversionFactor, Up)). A Decrease to 55 on a line
  // bought in tens became 60, and the next run offered "Decrease to 55" again.
  describe("on a purchase order line, quantities are whole purchase units", () => {
    const decrease = (order: {
      quantity: number;
      conversionFactor?: number;
      need: number;
    }) =>
      deriveChangeActions({
        ...base,
        onHand: 0,
        demandPeriods: [
          { periodId: "p2", startDate: "2026-10-12", quantity: order.need }
        ],
        openOrders: [
          {
            purchaseOrderLineId: "pol-1",
            quantity: order.quantity,
            conversionFactor: order.conversionFactor,
            dueDate: "2026-10-12", // on time → no date action
            requiresManualAction: false
          }
        ]
      });

    it("decreases to the next whole purchase unit above the requirement", () => {
      const actions = decrease({
        quantity: 100,
        conversionFactor: 10,
        need: 55
      });
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: "Decrease",
        suggestedQuantity: 60
      });
    });

    it("raises nothing once the line is already at that whole purchase unit", () => {
      expect(
        decrease({ quantity: 60, conversionFactor: 10, need: 55 })
      ).toEqual([]);
    });

    it("raises nothing for a fractional requirement a whole unit already covers", () => {
      expect(
        decrease({ quantity: 13, conversionFactor: 1, need: 12.5 })
      ).toEqual([]);
      // a line with no factor is bought one for one
      expect(decrease({ quantity: 13, need: 12.5 })).toEqual([]);
    });

    it("leaves a job's quantity unrounded", () => {
      const actions = deriveChangeActions({
        ...base,
        onHand: 0,
        demandPeriods: [
          { periodId: "p2", startDate: "2026-10-12", quantity: 12.5 }
        ],
        openOrders: [
          {
            jobId: "job-1",
            quantity: 13,
            dueDate: "2026-10-12",
            requiresManualAction: false
          }
        ]
      });
      expect(actions[0]).toMatchObject({
        type: "Decrease",
        suggestedQuantity: 12.5
      });
    });
  });

  // MRP's weeks start on Sunday; most days, that is before today. Apply
  // writes an Expedite's date onto the order, so an Expedite to the week
  // start put the order "overdue", it read as arriving today, four days after
  // the week start it was measured against, and the same Expedite came back
  // every run.
  describe("an Expedite never asks for a date before today", () => {
    const weeks = [
      { id: "w1", startDate: "2026-10-04" }, // Sunday
      { id: "w2", startDate: "2026-10-11" },
      { id: "w3", startDate: "2026-10-18" },
      { id: "w4", startDate: "2026-10-25" },
      { id: "w5", startDate: "2026-11-01" }
    ];
    const thursday = "2026-10-08";
    const expedite = (dueDate: string) =>
      deriveChangeActions({
        periods: weeks,
        policyFloor: 0,
        toleranceDays: 2,
        todayDate: thursday,
        onHand: 0,
        demandPeriods: [
          { periodId: "w1", startDate: "2026-10-04", quantity: 10 }
        ],
        openOrders: [
          {
            purchaseOrderLineId: "pol-1",
            quantity: 10,
            dueDate,
            requiresManualAction: false
          }
        ]
      });

    it("raises nothing for a line already moved to this week's start", () => {
      expect(expedite("2026-10-04")).toEqual([]);
    });

    it("raises nothing for a line already due today", () => {
      expect(expedite(thursday)).toEqual([]);
    });

    it("expedites a later line to today, not to the week start", () => {
      const actions = expedite("2026-11-01");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: "Expedite",
        periodId: "w1",
        suggestedDate: thursday,
        horizonDate: thursday,
        isASAP: true,
        reason: "Needed 24 days earlier than its current date"
      });
    });
  });
});

describe("order-quantity rules on change actions", () => {
  const jobDecrease = (
    need: number,
    quantity: number,
    orderRules: { minimum: number; multiples: number[] }
  ) =>
    deriveChangeActions({
      ...base,
      onHand: 0,
      demandPeriods: [
        { periodId: "p2", startDate: "2026-10-12", quantity: need }
      ],
      openOrders: [
        {
          jobId: "job-1",
          quantity,
          dueDate: "2026-10-12", // on time → no date action
          requiresManualAction: false
        }
      ],
      orderRules
    });

  it("decreases a job to a whole order multiple, not the bare requirement", () => {
    const actions = jobDecrease(37, 50, { minimum: 0, multiples: [10] });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "Decrease",
      suggestedQuantity: 40
    });
  });

  it("raises nothing when the order is already the smallest multiple that covers", () => {
    expect(jobDecrease(37, 40, { minimum: 0, multiples: [10] })).toEqual([]);
  });

  it("keeps a Fixed Reorder Quantity order on whole reorder quantities", () => {
    const actions = jobDecrease(150, 300, { minimum: 0, multiples: [100] });
    expect(actions[0]).toMatchObject({
      type: "Decrease",
      suggestedQuantity: 200
    });
  });

  it("never decreases below the minimum order quantity", () => {
    const actions = jobDecrease(12, 50, { minimum: 25, multiples: [] });
    expect(actions[0]).toMatchObject({
      type: "Decrease",
      suggestedQuantity: 25
    });
  });
});

// An order whose due date less lead time is before today is already being
// made or shipped. HR-TORSO: an overdue job J000438 (111) got "Increase to
// 131" beside a Make for the same week, and the planner read the two as
// ordering twice. Nothing can change such an order in time.
describe("frozen orders (due date less lead time before today)", () => {
  // TODAY is 2026-09-11
  it("is frozen when overdue, or due sooner than a lead time away", () => {
    expect(isOrderFrozen({ dueDate: "2026-09-04" }, TODAY)).toBe(true);
    expect(isOrderFrozen({ dueDate: "2026-09-11" }, TODAY)).toBe(false);
    expect(isOrderFrozen({ dueDate: "2026-09-15" }, TODAY, 7)).toBe(true);
    expect(isOrderFrozen({ dueDate: "2026-09-18" }, TODAY, 7)).toBe(false);
  });

  const overdueJob = {
    jobId: "job-1",
    quantity: 111,
    dueDate: "2026-09-04",
    requiresManualAction: true
  };

  it("never increases an overdue order — the shortfall stays a new order", () => {
    const make = {
      type: "Make" as const,
      periodId: "p1",
      suggestedQuantity: 20,
      suggestedDate: "2026-09-11",
      horizonDate: "2026-09-11",
      latestOrderDate: "2026-09-04",
      isASAP: true,
      purchaseOrderLineId: null,
      jobId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: "Demand-Based Reorder",
      reason: null,
      triggerValues: null
    };
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [make],
      openOrders: [overdueJob],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY,
      leadTimeDays: 7
    });
    expect(action).toMatchObject({ type: "Make", suggestedQuantity: 20 });
  });

  it("never decreases a frozen order", () => {
    expect(
      deriveChangeActions({
        ...base,
        onHand: 0,
        demandPeriods: [
          { periodId: "p1", startDate: "2026-10-05", quantity: 30 }
        ],
        openOrders: [overdueJob],
        leadTimeDays: 7
      }).filter((action) => action.type === "Decrease")
    ).toEqual([]);
  });

  it("never expedites a frozen order, and the projection leaves it where it lands", () => {
    // needed in p1 (Oct 5), lands in p3 (Oct 19); a 60-day lead time means
    // it is already in flight
    const late = {
      purchaseOrderLineId: "pol-1",
      quantity: 10,
      dueDate: "2026-10-19",
      requiresManualAction: false
    };
    const coverage = {
      onHand: 0,
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [late],
      periods: PERIODS,
      policyFloor: 0
    };
    expect(
      deriveChangeActions({
        ...coverage,
        toleranceDays: TOLERANCE,
        todayDate: TODAY,
        leadTimeDays: 60
      })
    ).toEqual([]);
    expect(
      firstNeedPeriodByOrder(coverage, {
        toleranceDays: TOLERANCE,
        todayDate: TODAY,
        leadTimeDays: 60
      }).has("pol-1")
    ).toBe(false);
    // with time to change it, it is expedited as before
    expect(
      deriveChangeActions({
        ...coverage,
        toleranceDays: TOLERANCE,
        todayDate: TODAY,
        leadTimeDays: 7
      })[0]
    ).toMatchObject({ type: "Expedite" });
  });
});

describe("convertOrdersToIncreases", () => {
  const orderCandidate = {
    type: "Order" as const,
    periodId: "p2",
    suggestedQuantity: 5,
    suggestedDate: "2026-10-12",
    horizonDate: "2026-10-12",
    latestOrderDate: "2026-10-07",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    requiresManualAction: false,
    supplierId: "sup-1",
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: null
  };

  it("folds a new-order suggestion into a same-window open PO as one Increase", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    expect(action).toMatchObject({
      type: "Increase",
      purchaseOrderLineId: "pol-1",
      suggestedQuantity: 15 // existing 10 + shortfall 5
    });
  });

  it("an Increase keeps the order-by date and takes the earlier fence date", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-09", // 3 days before the suggestion, inside tolerance
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    expect(action).toMatchObject({
      type: "Increase",
      horizonDate: "2026-10-09",
      latestOrderDate: "2026-10-07"
    });
  });

  it("keeps the Order when the open PO already carries a date action (one action per target)", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [
        {
          type: "Expedite",
          periodId: "p1",
          suggestedQuantity: 10,
          suggestedDate: "2026-10-05",
          horizonDate: "2026-10-05",
          latestOrderDate: null,
          isASAP: false,
          purchaseOrderLineId: "pol-1",
          jobId: null,
          requiresManualAction: false,
          supplierId: null,
          policyName: null,
          reason: null,
          triggerValues: null
        }
      ],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    expect(action?.type).toBe("Order");
  });

  it("never grows a job past the batch size — the batch stays a new job", () => {
    const make = {
      ...orderCandidate,
      type: "Make" as const,
      supplierId: null,
      suggestedQuantity: 50
    };
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [make],
      openOrders: [
        {
          jobId: "job-1",
          quantity: 50,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY,
      maximumPerOrder: 50
    });
    expect(action).toMatchObject({ type: "Make", suggestedQuantity: 50 });
  });

  it("still folds a suggestion the open order has room for", () => {
    const make = {
      ...orderCandidate,
      type: "Make" as const,
      supplierId: null,
      suggestedQuantity: 20
    };
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [make],
      openOrders: [
        {
          jobId: "job-1",
          quantity: 30,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY,
      maximumPerOrder: 50
    });
    expect(action).toMatchObject({
      type: "Increase",
      jobId: "job-1",
      suggestedQuantity: 50
    });
  });

  it("never grows a PO line past the maximum order quantity", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY,
      maximumPerOrder: 12
    });
    expect(action).toMatchObject({ type: "Order", suggestedQuantity: 5 });
  });

  it("never folds a Make suggestion into a purchase order", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [{ ...orderCandidate, type: "Make" as const }],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    expect(action?.type).toBe("Make");
  });

  // The Increase is a change to THAT line, on that line's PO; the item's
  // preferred supplier may not be the one it was bought from.
  it("names the purchase order line's supplier, not the item's preferred one", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false,
          supplierId: "sup-on-po"
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    expect(action).toMatchObject({
      type: "Increase",
      supplierId: "sup-on-po"
    });
  });

  it("sizes an Increase on a purchase order line in whole purchase units", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [orderCandidate],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 60,
          conversionFactor: 10,
          dueDate: "2026-10-12",
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: TOLERANCE,
      todayDate: TODAY
    });
    // 60 + 5 is 6.5 purchase units; Apply writes 7
    expect(action).toMatchObject({ type: "Increase", suggestedQuantity: 70 });
  });

  // This week's suggestion is due on the week's Sunday; an order expedited
  // to today is the same week's supply, whatever the tolerance.
  it("folds this week's suggestion into an order due today", () => {
    const [action] = convertOrdersToIncreases({
      sizingCandidates: [
        {
          ...orderCandidate,
          suggestedDate: "2026-10-04", // Sunday, the week start
          horizonDate: "2026-10-04"
        }
      ],
      openOrders: [
        {
          purchaseOrderLineId: "pol-1",
          quantity: 10,
          dueDate: "2026-10-08", // today, a Thursday
          requiresManualAction: false
        }
      ],
      changeActions: [],
      toleranceDays: 2,
      todayDate: "2026-10-08"
    });
    expect(action).toMatchObject({
      type: "Increase",
      purchaseOrderLineId: "pol-1"
    });
  });
});

describe("diffPlanningActions", () => {
  const candidate: PlanningActionCandidate = {
    itemId: "item-1",
    locationId: "loc-1",
    periodId: "p1",
    type: "Order",
    suggestedQuantity: 10,
    suggestedDate: "2026-10-05",
    horizonDate: "2026-10-05",
    latestOrderDate: "2026-09-30",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    requiresManualAction: false,
    supplierId: "sup-1",
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: { safetyStock: 10 },
    assignee: "buyer-1"
  };

  const existing: ExistingPlanningAction = {
    id: "pla-1",
    itemId: "item-1",
    locationId: "loc-1",
    periodId: "p1",
    type: "Order",
    status: "Open",
    suggestedQuantity: 10,
    suggestedDate: "2026-10-05",
    horizonDate: "2026-10-05",
    latestOrderDate: "2026-09-30",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    requiresManualAction: false,
    supplierId: "sup-1",
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: { safetyStock: 10 },
    assignee: "buyer-1",
    assigneeOverridden: false
  };

  it("two identical runs produce zero changes (idempotency)", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("triggerValues equality ignores jsonb key order (idempotency)", () => {
    // jsonb returns keys length-then-bytewise; the candidate builds them in
    // insertion order — identical values must not produce an update.
    const diff = diffPlanningActions({
      existing: [
        {
          ...existing,
          triggerValues: { reorderPoint: 5, leadTime: 14, projectedStock: 2 }
        }
      ],
      candidates: [
        {
          ...candidate,
          triggerValues: { projectedStock: 2, reorderPoint: 5, leadTime: 14 }
        }
      ],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("triggerValues equality still detects a changed value", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, triggerValues: { safetyStock: 10 } }],
      candidates: [{ ...candidate, triggerValues: { safetyStock: 12 } }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { triggerValues: { safetyStock: 12 } } }
    ]);
  });

  it("inserts a new candidate, deletes a vanished row", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [{ ...candidate, periodId: "p2" }],
      toleranceDays: TOLERANCE
    });
    expect(diff.inserts).toHaveLength(1);
    expect(diff.deleteIds).toEqual(["pla-1"]);
  });

  it("updates an Open row in place when the suggestion changes", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [{ ...candidate, suggestedQuantity: 12 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { suggestedQuantity: 12 } }
    ]);
  });

  it("preserves a human-overridden assignee but still refreshes the suggestion", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, assignee: "lead-1", assigneeOverridden: true }],
      candidates: [{ ...candidate, suggestedQuantity: 12 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]?.patch).toEqual({ suggestedQuantity: 12 });
    expect(diff.updates[0]?.patch).not.toHaveProperty("assignee");
  });

  it("a Dismissed row stays dismissed across an unchanged run", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("refreshes the grid-facing dates on an Open row", () => {
    const diff = diffPlanningActions({
      existing: [
        { ...existing, horizonDate: "2026-10-12", latestOrderDate: null }
      ],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      {
        id: "pla-1",
        patch: { horizonDate: "2026-10-05", latestOrderDate: "2026-09-30" }
      }
    ]);
  });

  it("refreshes the grid-facing dates on a Dismissed row WITHOUT reopening it", () => {
    const diff = diffPlanningActions({
      existing: [
        { ...existing, status: "Dismissed", horizonDate: "2026-10-12" }
      ],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { horizonDate: "2026-10-05" } }
    ]);
  });

  it("float noise in the candidate quantity is not a material change", () => {
    // 0.1 + 0.2 is 0.30000000000000004: the same need, re-summed in a
    // different row order, must not reopen a Dismissed row.
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed", suggestedQuantity: 0.3 }],
      candidates: [{ ...candidate, suggestedQuantity: 0.1 + 0.2 }],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("reopens a Dismissed row on a material change", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [{ ...candidate, suggestedQuantity: 20 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]?.patch).toMatchObject({
      status: "Open",
      suggestedQuantity: 20
    });
  });

  it("deletes a Dismissed row whose need vanished so a returning need re-surfaces", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [],
      toleranceDays: TOLERANCE
    });
    expect(diff.deleteIds).toEqual(["pla-1"]);
  });

  it("keys change actions by their target document", () => {
    const expediteA = naturalKey({
      itemId: "item-1",
      locationId: "loc-1",
      type: "Expedite",
      periodId: "p1",
      purchaseOrderLineId: "pol-a",
      jobId: null
    });
    const expediteB = naturalKey({
      itemId: "item-1",
      locationId: "loc-1",
      type: "Expedite",
      periodId: "p1",
      purchaseOrderLineId: "pol-b",
      jobId: null
    });
    expect(expediteA).not.toBe(expediteB);
  });

  it("passes candidate fields (incl. assignee) through to inserts unchanged", () => {
    const diff = diffPlanningActions({
      existing: [],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.inserts[0]).toEqual(candidate);
  });

  // MRP puts current and overdue demand in the first week, a different week
  // every Sunday, and a change action's need moves with it. Keyed on the week,
  // each such action got a new row weekly, losing its dismissal and assignee.
  describe("identity across weeks", () => {
    const thisRun = PERIODS; // p1 is the current week
    const lastWeek = "p0"; // a week before this run's first

    it("keys a change action by its order, whatever week its need is in", () => {
      const expedite = (periodId: string) =>
        naturalKey({
          itemId: "item-1",
          locationId: "loc-1",
          type: "Expedite",
          periodId,
          purchaseOrderLineId: "pol-a",
          jobId: null
        });
      expect(expedite("p1")).toBe(expedite("p2"));
    });

    it("keys every week up to the current one as one 'now', later weeks apart", () => {
      const keyPeriod = keyPeriodFor(thisRun);
      expect(keyPeriod(lastWeek)).toBe("now");
      expect(keyPeriod("p1")).toBe("now");
      expect(keyPeriod("p2")).toBe("p2");
    });

    it("moves a dismissed change action to its new week instead of replacing it", () => {
      const dismissed: ExistingPlanningAction = {
        ...existing,
        type: "Expedite",
        status: "Dismissed",
        periodId: "p1",
        purchaseOrderLineId: "pol-a"
      };
      const diff = diffPlanningActions({
        existing: [dismissed],
        candidates: [
          {
            ...candidate,
            type: "Expedite",
            periodId: "p2",
            purchaseOrderLineId: "pol-a"
          }
        ],
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.inserts).toEqual([]);
      expect(diff.deleteIds).toEqual([]);
      expect(diff.updates).toEqual([
        { id: "pla-1", patch: { periodId: "p2" } }
      ]);
    });

    it("keeps last week's current-week Order, and its assignee, when the shortage goes on", () => {
      const lastWeeksOrder: ExistingPlanningAction = {
        ...existing,
        periodId: lastWeek,
        assignee: "planner-2",
        assigneeOverridden: true
      };
      const diff = diffPlanningActions({
        existing: [lastWeeksOrder],
        candidates: [candidate], // p1
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.inserts).toEqual([]);
      expect(diff.deleteIds).toEqual([]);
      expect(diff.updates).toEqual([
        { id: "pla-1", patch: { periodId: "p1" } }
      ]);
    });

    it("keeps the row already on the current week when two share 'now'", () => {
      const diff = diffPlanningActions({
        existing: [
          { ...existing, id: "pla-old", periodId: lastWeek },
          { ...existing, id: "pla-now", periodId: "p1" }
        ],
        candidates: [candidate],
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.deleteIds).toEqual(["pla-old"]);
      expect(diff.updates).toEqual([]);
      expect(diff.inserts).toEqual([]);
    });
  });
});

// An Expedite and a new Order could both answer one shortage: sizing read the
// projection with the late order still in its old week. Sizing now reads the
// projection with every Expedite done.
describe("projectionsWithExpedites", () => {
  const expedite = (purchaseOrderLineId: string, periodId: string) => ({
    type: "Expedite" as const,
    periodId,
    purchaseOrderLineId,
    jobId: null
  });
  // p1..p5, stock below zero in p2 and p3 until the PO lands in p4
  const projections = [5, -5, -5, 5, 5];
  const lateOrder = {
    purchaseOrderLineId: "pol-1",
    quantity: 10,
    dueDate: "2026-10-28", // lands in p4
    requiresManualAction: false
  };

  it("counts an expedited order from its need week instead of its landing week", () => {
    expect(
      projectionsWithExpedites({
        projections,
        periods: PERIODS,
        changeActions: [expedite("pol-1", "p2")],
        openOrders: [lateOrder]
      })
    ).toEqual([5, 5, 5, 5, 5]);
  });

  it("covers to the end for an order landing after the last week", () => {
    expect(
      projectionsWithExpedites({
        projections: [5, -5, -5, -5, -5],
        periods: PERIODS,
        changeActions: [expedite("pol-1", "p2")],
        openOrders: [{ ...lateOrder, dueDate: "2026-12-14" }]
      })
    ).toEqual([5, 5, 5, 5, 5]);
  });

  it("leaves the projection alone for every action but Expedite", () => {
    expect(
      projectionsWithExpedites({
        projections,
        periods: PERIODS,
        changeActions: [{ ...expedite("pol-1", "p2"), type: "Defer" as const }],
        openOrders: [lateOrder]
      })
    ).toEqual(projections);
  });

  // Late within the tolerance: no Expedite, but the order still covers the
  // need, so it counts from the need week.
  it("counts an order from its first need week when no action moves it", () => {
    expect(
      projectionsWithExpedites({
        projections,
        periods: PERIODS,
        changeActions: [],
        openOrders: [lateOrder],
        firstNeedPeriods: new Map([["pol-1", "p2"]])
      })
    ).toEqual([5, 5, 5, 5, 5]);
  });

  it("moves an order needed after it lands nowhere", () => {
    expect(
      projectionsWithExpedites({
        projections,
        periods: PERIODS,
        changeActions: [],
        openOrders: [lateOrder],
        firstNeedPeriods: new Map([["pol-1", "p5"]])
      })
    ).toEqual(projections);
  });

  it("moves an expedited order once, not once per source", () => {
    expect(
      projectionsWithExpedites({
        projections,
        periods: PERIODS,
        changeActions: [expedite("pol-1", "p2")],
        openOrders: [lateOrder],
        firstNeedPeriods: new Map([["pol-1", "p2"]])
      })
    ).toEqual([5, 5, 5, 5, 5]);
  });
});

// The whole new-supply path for one item, as generatePlanningActions runs it:
// the change actions, then sizing on the adjusted projection, then the fold
// into an open order.
describe("new supply beside an order late within the tolerance", () => {
  const periods = [
    { id: "w0", startDate: "2026-10-04", endDate: "2026-10-10" },
    { id: "w1", startDate: "2026-10-11", endDate: "2026-10-17" },
    { id: "w2", startDate: "2026-10-18", endDate: "2026-10-24" },
    { id: "w3", startDate: "2026-10-25", endDate: "2026-10-31" }
  ];
  const today = "2026-10-06";

  function plan(demandPeriodId: string, poDue: string, raw: number[]) {
    const openOrders = [
      {
        purchaseOrderLineId: "X",
        quantity: 100,
        dueDate: poDue,
        requiresManualAction: false
      }
    ];
    const coverageInput = {
      onHand: 0,
      demandPeriods: [
        {
          periodId: demandPeriodId,
          startDate: periods.find((p) => p.id === demandPeriodId)!.startDate,
          quantity: 100
        }
      ],
      openOrders,
      periods,
      policyFloor: 0
    };
    const changeActions = deriveChangeActions({
      ...coverageInput,
      toleranceDays: TOLERANCE,
      todayDate: today
    });
    const sizing = computePlanningOrders({
      reorderingPolicy: "Demand-Based Reorder",
      periods,
      projections: projectionsWithExpedites({
        projections: raw,
        periods,
        changeActions,
        openOrders,
        firstNeedPeriods: firstNeedPeriodByOrder(coverageInput)
      }),
      todayDate: today,
      params: {
        reorderPoint: 0,
        reorderQuantity: 0,
        minimumOrderQuantity: 0,
        maximumOrderQuantity: 0,
        orderMultiple: 0,
        lotSize: 0,
        maximumInventoryQuantity: 0,
        demandAccumulationPeriod: 1,
        demandAccumulationSafetyStock: 0,
        leadTime: 0
      }
    }).map((o) => ({
      type: "Order" as const,
      periodId: o.periodId,
      suggestedQuantity: o.quantity,
      suggestedDate: o.dueDate,
      horizonDate: o.dueDate,
      latestOrderDate: o.startDate,
      isASAP: o.isASAP,
      purchaseOrderLineId: null,
      jobId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: o.policyName,
      reason: null,
      triggerValues: null
    }));
    return {
      changeActions,
      merged: convertOrdersToIncreases({
        sizingCandidates: sizing,
        openOrders,
        changeActions,
        toleranceDays: TOLERANCE,
        todayDate: today
      })
    };
  }

  // A need of 100 this week, the PO for 100 landing next Sunday — 5 days,
  // inside the 7-day tolerance. MRP's weekly projection still books the PO in
  // next week, so this week read short by 100, sizing ordered 100 and the
  // fold made it "Increase from 100 to 200" for a need the PO already covers.
  it("suggests nothing for a need this week the PO covers a few days late", () => {
    const { changeActions, merged } = plan("w0", "2026-10-11", [-100, 0, 0, 0]);
    expect(changeActions).toEqual([]);
    expect(merged).toEqual([]);
  });

  it("suggests nothing for a later need the PO covers at the next week start", () => {
    const { changeActions, merged } = plan("w2", "2026-10-25", [0, 0, -100, 0]);
    expect(changeActions).toEqual([]);
    expect(merged).toEqual([]);
  });

  it("still expedites an order late beyond the tolerance, with no new order", () => {
    const { changeActions, merged } = plan(
      "w0",
      "2026-10-18",
      [-100, -100, 0, 0]
    );
    expect(changeActions.map((a) => a.type)).toEqual(["Expedite"]);
    expect(merged).toEqual([]);
  });
});

describe("releaseByDate", () => {
  it("is the day before the due date less the lead time", () => {
    // due in 8 days with a 7-day lead time: release today
    expect(releaseByDate("2026-10-14", 7)).toBe("2026-10-06");
  });

  it("is the day before the due date with no lead time", () => {
    expect(releaseByDate("2026-10-14", 0)).toBe("2026-10-13");
  });
});

describe("earlierRelease", () => {
  const release = (date: string) => ({ date, dueDate: date, leadTime: 0 });

  it("keeps the release that comes first, whichever is passed first", () => {
    expect(
      earlierRelease(release("2026-10-08"), release("2026-10-12")).date
    ).toBe("2026-10-08");
    expect(
      earlierRelease(release("2026-10-12"), release("2026-10-08")).date
    ).toBe("2026-10-08");
    expect(earlierRelease(null, release("2026-10-12")).date).toBe("2026-10-12");
  });
});

describe("deriveReleaseActions", () => {
  const today = "2026-10-06";
  const periods = [
    { id: "w0", startDate: "2026-10-04" },
    { id: "w1", startDate: "2026-10-11" },
    { id: "w2", startDate: "2026-10-18" }
  ];
  const planned = (purchaseOrderLineId: string, releaseDate: string) => ({
    purchaseOrderLineId,
    quantity: 10,
    dueDate: "2026-10-20",
    requiresManualAction: false,
    release: { date: releaseDate, dueDate: "2026-10-20", leadTime: 7 }
  });

  it("raises one Release per planned order, dated its release day", () => {
    const [release] = deriveReleaseActions({
      openOrders: [planned("pol-1", "2026-10-12")],
      changeActions: [],
      periods,
      todayDate: "2026-10-11"
    });
    expect(release).toMatchObject({
      type: "Release",
      purchaseOrderLineId: "pol-1",
      suggestedDate: "2026-10-12",
      horizonDate: "2026-10-12",
      periodId: "w1",
      isASAP: false,
      latestOrderDate: null,
      requiresManualAction: false,
      reason: "Due 2026-10-20 with a 7-day lead time"
    });
  });

  it("flags a release due today or already late as ASAP", () => {
    const actions = deriveReleaseActions({
      openOrders: [planned("today", today), planned("late", "2026-10-01")],
      changeActions: [],
      periods,
      todayDate: today
    });
    expect(
      actions.map((a) => [a.purchaseOrderLineId, a.isASAP, a.periodId])
    ).toEqual([
      ["today", true, "w0"],
      ["late", true, "w0"]
    ]);
  });

  it("waits until the day before the release day", () => {
    const actions = deriveReleaseActions({
      openOrders: [
        planned("tomorrow", "2026-10-07"),
        planned("in-two-days", "2026-10-08"),
        planned("next-week", "2026-10-12")
      ],
      changeActions: [],
      periods,
      todayDate: today
    });
    expect(actions.map((a) => [a.purchaseOrderLineId, a.isASAP])).toEqual([
      ["tomorrow", false]
    ]);
  });

  it("raises nothing for an order past Planned", () => {
    expect(
      deriveReleaseActions({
        openOrders: [{ ...planned("pol-1", today), release: null }],
        changeActions: [],
        periods,
        todayDate: today
      })
    ).toEqual([]);
  });

  it("raises nothing for an order MRP would cancel", () => {
    expect(
      deriveReleaseActions({
        openOrders: [planned("pol-1", today)],
        changeActions: [
          { type: "Cancel", purchaseOrderLineId: "pol-1", jobId: null }
        ],
        periods,
        todayDate: today
      })
    ).toEqual([]);
  });

  it("keeps a Release beside a change to the same order", () => {
    expect(
      deriveReleaseActions({
        openOrders: [planned("pol-1", today)],
        changeActions: [
          { type: "Increase", purchaseOrderLineId: "pol-1", jobId: null }
        ],
        periods,
        todayDate: today
      })
    ).toHaveLength(1);
  });
});
