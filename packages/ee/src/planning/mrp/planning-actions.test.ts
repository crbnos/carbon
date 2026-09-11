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
  isCommittedJobStatus,
  isCommittedPurchaseOrderStatus,
  naturalKey
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
      periodId: "p4"
    });
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
});

describe("convertOrdersToIncreases", () => {
  const orderCandidate = {
    type: "Order" as const,
    periodId: "p2",
    suggestedQuantity: 5,
    suggestedDate: "2026-10-12",
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
});
