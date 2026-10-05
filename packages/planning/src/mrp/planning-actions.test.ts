// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  ExistingPlanningAction,
  PlanningActionCandidate
} from "./planning-actions";
import {
  convertOrdersToIncreases,
  daysBetween,
  deriveChangeActions,
  diffPlanningActions,
  earlierDate,
  isCommittedJobStatus,
  isCommittedPurchaseOrderStatus,
  keyPeriodFor,
  naturalKey,
  projectionsWithExpedites
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
    ]) {
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
      toleranceDays: TOLERANCE
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
      toleranceDays: TOLERANCE
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
      toleranceDays: TOLERANCE
    });
    expect(action?.type).toBe("Order");
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
      toleranceDays: TOLERANCE
    });
    expect(action?.type).toBe("Make");
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
});
