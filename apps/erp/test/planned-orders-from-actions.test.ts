// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import {
  classifyPlanningOrders,
  pastStartRefusalMessages,
  planningOrderDatesAreValid,
  planningOrderStart,
  planningOrderStartsInPast
} from "../app/modules/production/production.models";
import { planningRowKey } from "../app/modules/production/ui/Planning/planning-action-scope";
import {
  draftsOfRefusedOrders,
  openNewSupplyActions,
  plannedOrdersFromActions,
  productionOrdersFromActions,
  purchaseUnitsFor,
  refusedOrdersOfRow,
  supplierConversionFactor,
  withoutRowDraft
} from "../app/modules/production/ui/Planning/planned-orders-from-actions";
import { rowsReplannedByApply } from "../app/modules/production/ui/Planning/usePlanningActions";

type Action = Parameters<typeof plannedOrdersFromActions>[0][number];

const action = (overrides: Partial<Action> = {}): Action => ({
  id: "act1",
  type: "Order",
  status: "Open",
  purchaseOrderLineId: null,
  jobId: null,
  periodId: "w1",
  suggestedQuantity: 10,
  suggestedDate: "2026-10-05",
  latestOrderDate: "2026-07-07",
  isASAP: true,
  supplierId: "sup1",
  policyName: "Fixed Reorder Quantity",
  reason: null,
  triggerValues: null,
  ...overrides
});

// RW-010: the drawer sized ten-unit orders per day in the browser while MRP
// wrote one action per week, after folding the first shortfall into PO000001
// as an Increase. The drawer now lists exactly the item's Order actions.
describe("openNewSupplyActions", () => {
  it("keeps only the open suggestions for new supply of the kind asked", () => {
    const order = action({ periodId: "w1" });
    const later = action({ periodId: "w2", suggestedDate: "2026-10-11" });
    const actions = [
      order,
      action({ type: "Increase", purchaseOrderLineId: "pol1" }),
      action({ type: "Expedite", purchaseOrderLineId: "pol4" }),
      action({ status: "Dismissed", periodId: "w3" }),
      action({ type: "Make", periodId: "w4" }),
      later
    ];
    expect(openNewSupplyActions(actions, "Order")).toEqual([order, later]);
  });

  it("treats an item with no actions as nothing to order", () => {
    expect(openNewSupplyActions(undefined, "Make")).toEqual([]);
  });
});

describe("plannedOrdersFromActions", () => {
  it("lists one order per weekly action, on the action's own week", () => {
    const orders = plannedOrdersFromActions(
      [
        action({ suggestedQuantity: 40 }),
        action({
          periodId: "w2",
          suggestedQuantity: 50,
          suggestedDate: "2026-10-11",
          latestOrderDate: "2026-07-13",
          isASAP: false
        })
      ],
      { conversionFactor: 1, supplierId: "sup1" }
    );
    expect(
      orders.map(({ quantity, dueDate, startDate, periodId }) => ({
        quantity,
        dueDate,
        startDate,
        periodId
      }))
    ).toEqual([
      {
        quantity: 40,
        dueDate: "2026-10-05",
        startDate: "2026-07-07",
        periodId: "w1"
      },
      {
        quantity: 50,
        dueDate: "2026-10-11",
        startDate: "2026-07-13",
        periodId: "w2"
      }
    ]);
  });

  it("converts inventory units to whole purchase units, rounding up", () => {
    const [order] = plannedOrdersFromActions(
      [action({ suggestedQuantity: 40 })],
      { conversionFactor: 12 }
    );
    expect(order.quantity).toBe(4);
  });

  it("keeps the quantity when the conversion factor is not usable", () => {
    const [order] = plannedOrdersFromActions(
      [action({ suggestedQuantity: 40 })],
      { conversionFactor: 0 }
    );
    expect(order.quantity).toBe(40);
  });

  it("orders from the row's supplier, else the action's", () => {
    const [chosen] = plannedOrdersFromActions([action()], {
      conversionFactor: 1,
      supplierId: "sup2"
    });
    const [fallback] = plannedOrdersFromActions([action()], {
      conversionFactor: 1
    });
    expect(chosen.supplierId).toBe("sup2");
    expect(fallback.supplierId).toBe("sup1");
  });

  it("dates an action with no order-by date from its due date", () => {
    const [order] = plannedOrdersFromActions(
      [action({ latestOrderDate: null })],
      { conversionFactor: 1 }
    );
    expect(order.startDate).toBe("2026-10-05");
  });

  it("carries the policy attribution, numbers only", () => {
    const [order] = plannedOrdersFromActions(
      [
        action({
          reason: "Below reorder point",
          triggerValues: { reorderPoint: 5, reorderQuantity: 10, note: "x" }
        })
      ],
      { conversionFactor: 1 }
    );
    expect(order.policyName).toBe("Fixed Reorder Quantity");
    expect(order.reason).toBe("Below reorder point");
    expect(order.triggerValues).toEqual({
      reorderPoint: 5,
      reorderQuantity: 10
    });
  });
});

describe("productionOrdersFromActions", () => {
  it("lists one job per Make action in the item's own units", () => {
    expect(
      productionOrdersFromActions([
        action({
          type: "Make",
          suggestedQuantity: 5,
          suggestedDate: "2026-10-04",
          latestOrderDate: "2026-09-20",
          isASAP: true
        })
      ])
    ).toEqual([
      {
        startDate: "2026-09-20",
        dueDate: "2026-10-04",
        periodId: "w1",
        quantity: 5,
        isASAP: true,
        planningActionId: "act1",
        policyName: "Fixed Reorder Quantity"
      }
    ]);
  });

  // Make settles the action by what is ordered against it, so every job the
  // action splits into names it, and keeps naming it through drawer edits.
  it("names its action on every job it splits into", () => {
    const make = (id: string, suggestedQuantity: number) =>
      action({
        id,
        type: "Make",
        policyName: "Demand-Based Reorder",
        suggestedQuantity
      });
    const orders = productionOrdersFromActions(
      [make("act1", 120), make("act2", 30)],
      { item: { lotSize: 50 } }
    );
    expect(orders.map((o) => [o.planningActionId, o.quantity])).toEqual([
      ["act1", 50],
      ["act1", 50],
      ["act1", 20],
      ["act2", 30]
    ]);
  });

  it("names its action on every purchase order it splits into", () => {
    const orders = plannedOrdersFromActions(
      [
        action({
          id: "act1",
          policyName: "Demand-Based Reorder",
          suggestedQuantity: 120
        })
      ],
      { conversionFactor: 1, item: { lotSize: 50 } }
    );
    expect(orders.map((o) => [o.planningActionId, o.quantity])).toEqual([
      ["act1", 50],
      ["act1", 50],
      ["act1", 20]
    ]);
  });

  // The chart's order popover explains a suggestion from these; production's
  // suggested jobs dropped them and the popover lost its policy section.
  it("carries the action's policy attribution", () => {
    const [order] = productionOrdersFromActions([
      action({
        type: "Make",
        policyName: "Demand-Based Reorder",
        reason: "Short in week 2",
        triggerValues: { projectedStock: -30, safetyStock: 0, note: "x" }
      })
    ]);
    expect(order).toMatchObject({
      policyName: "Demand-Based Reorder",
      reason: "Short in week 2",
      triggerValues: { projectedStock: -30, safetyStock: 0 }
    });
  });

  // MRP stores one ASAP flag per week, as of its run: every batch became an
  // ASAP job if any one was, and a job raised after its start date had passed
  // could still be a Soft Deadline.
  it("judges each job's ASAP from its own start date and today", () => {
    const make = action({
      type: "Make",
      policyName: "Demand-Based Reorder",
      suggestedQuantity: 120,
      suggestedDate: "2026-10-04",
      latestOrderDate: "2026-09-27",
      isASAP: false
    });
    expect(
      productionOrdersFromActions([make], {
        item: { lotSize: 50 },
        todayDate: "2026-09-29"
      }).map((o) => [o.startDate, o.isASAP])
    ).toEqual([
      ["2026-09-27", true],
      ["2026-09-29", false],
      ["2026-10-01", false]
    ]);
  });

  it("keeps Maximum Quantity's stock condition from the run", () => {
    const make = (isASAP: boolean) =>
      action({
        type: "Make",
        policyName: "Maximum Quantity",
        suggestedQuantity: 10,
        latestOrderDate: "2026-09-20",
        isASAP
      });
    const asap = (isASAP: boolean) =>
      productionOrdersFromActions([make(isASAP)], {
        todayDate: "2026-09-29"
      })[0]?.isASAP;
    expect(asap(true)).toBe(true);
    // started late, but the run found stock above zero: not ASAP
    expect(asap(false)).toBe(false);
  });
});

// MRP sums the orders a week needs into one action; one order per action
// turned a 120 on a batch size of 50 into a single job of 120, and three
// fixed reorders of 100 into one order of 300.
describe("orders split back by the policy that sized them", () => {
  const make = (policyName: string, suggestedQuantity: number) =>
    action({
      type: "Make",
      policyName,
      suggestedQuantity,
      suggestedDate: "2026-10-04",
      latestOrderDate: "2026-09-27",
      isASAP: false
    });

  it("Demand-Based Reorder: one job per batch, spread across the week", () => {
    expect(
      productionOrdersFromActions([make("Demand-Based Reorder", 120)], { item: {
        lotSize: 50
      } })
    ).toEqual([
      {
        startDate: "2026-09-27",
        dueDate: "2026-10-04",
        periodId: "w1",
        quantity: 50,
        isASAP: false,
        planningActionId: "act1",
        policyName: "Demand-Based Reorder"
      },
      {
        startDate: "2026-09-29",
        dueDate: "2026-10-06",
        periodId: "w1",
        quantity: 50,
        isASAP: false,
        planningActionId: "act1",
        policyName: "Demand-Based Reorder"
      },
      {
        startDate: "2026-10-01",
        dueDate: "2026-10-08",
        periodId: "w1",
        quantity: 20,
        isASAP: false,
        planningActionId: "act1",
        policyName: "Demand-Based Reorder"
      }
    ]);
  });

  it("keeps one job when the item has no batch size", () => {
    expect(
      productionOrdersFromActions([make("Demand-Based Reorder", 120)], { item: {
        lotSize: 0
      } }).map((o) => o.quantity)
    ).toEqual([120]);
  });

  it("Fixed Reorder Quantity: one order of that quantity per day", () => {
    const orders = productionOrdersFromActions(
      [make("Fixed Reorder Quantity", 300)],
      { item: { reorderQuantity: 100, lotSize: 40 } }
    );
    expect(orders.map((o) => [o.quantity, o.dueDate])).toEqual([
      [100, "2026-10-04"],
      [100, "2026-10-05"],
      [100, "2026-10-06"]
    ]);
  });

  it("Maximum Quantity: never an order past the maximum order quantity", () => {
    expect(
      productionOrdersFromActions([make("Maximum Quantity", 450)], { item: {
        maximumOrderQuantity: 200,
        lotSize: 50
      } }).map((o) => o.quantity)
    ).toEqual([200, 200, 50]);
  });

  it("Maximum Quantity keeps a lot-multiple order whole", () => {
    expect(
      productionOrdersFromActions([make("Maximum Quantity", 100)], { item: {
        lotSize: 50
      } }).map((o) => o.quantity)
    ).toEqual([100]);
  });

  it("Stock Only is one order of the shortfall", () => {
    expect(
      productionOrdersFromActions([make("Stock Only", 120)], { item: {
        lotSize: 50
      } }).map((o) => o.quantity)
    ).toEqual([120]);
  });

  it("splits a purchase action before converting to purchase units", () => {
    expect(
      plannedOrdersFromActions(
        [action({ policyName: "Fixed Reorder Quantity", suggestedQuantity: 120 })],
        { conversionFactor: 20, item: { reorderQuantity: 50 } }
      ).map((o) => o.quantity)
    ).toEqual([3, 3, 1]);
  });
});

describe("supplierConversionFactor", () => {
  const suppliers = [
    { supplierId: "sup1", conversionFactor: 12 },
    { supplierId: "sup2", conversionFactor: 1 }
  ];

  it("reads the chosen supplier's factor", () => {
    expect(supplierConversionFactor(suppliers, "sup1")).toBe(12);
  });

  it("is 1 for a supplier with no part, or no supplier data", () => {
    expect(supplierConversionFactor(suppliers, "sup3")).toBe(1);
    expect(supplierConversionFactor(null, "sup1")).toBe(1);
  });
});

// An order the planner adds in the purchasing drawer, and an Open Orders
// row's suggested quantity, are in whole purchase units, rounded up as Apply
// rounds them (`toReceive`, purchasing.models.ts).
describe("purchaseUnitsFor", () => {
  it("rounds an inventory quantity up to whole purchase units", () => {
    expect(purchaseUnitsFor(25, 10)).toBe(3);
    expect(purchaseUnitsFor(10.5, 1)).toBe(11);
  });

  it("does not round float noise up a whole purchase unit", () => {
    expect(purchaseUnitsFor(1.1, 0.1)).toBe(11);
    // 0.07 / 0.01 is 7.000000000000001 in floating point
    expect(purchaseUnitsFor(0.07, 0.01)).toBe(7);
    expect(purchaseUnitsFor(0.33, 0.03)).toBe(11);
  });

  it("keeps the quantity when the factor is not usable", () => {
    expect(purchaseUnitsFor(7, 0)).toBe(7);
    expect(purchaseUnitsFor(7, -2)).toBe(7);
  });
});

describe("planningOrderStartsInPast", () => {
  const today = "2026-11-05";

  it.each([
    ["starts yesterday", { startDate: "2026-11-04", dueDate: "2026-11-12" }, true],
    ["starts today", { startDate: "2026-11-05", dueDate: "2026-11-12" }, false],
    ["starts tomorrow", { startDate: "2026-11-06", dueDate: "2026-11-13" }, false],
    // no start: dated by its due date less the lead time, as the job would be
    ["no start, due tomorrow", { startDate: null, dueDate: "2026-11-06" }, true],
    ["no start, due a lead time away", { startDate: null, dueDate: "2026-11-12" }, false],
    ["no dates", { startDate: null, dueDate: null }, false]
  ] as const)("an order that %s is late: %s", (_, order, expected) => {
    expect(planningOrderStartsInPast(order, today, 7)).toBe(expected);
  });

  it("takes the start date over the due date", () => {
    expect(
      planningOrderStart({ startDate: "2026-11-09", dueDate: "2026-11-10" }, 7)
    ).toBe("2026-11-09");
  });
});

describe("planningOrderDatesAreValid", () => {
  it.each([
    ["two real days", { startDate: "2026-11-05", dueDate: "2026-11-12" }, true],
    ["no dates", { startDate: null, dueDate: null }, true],
    ["an ISO timestamp", { startDate: null, dueDate: "2026-11-12T00:00:00Z" }, false],
    ["a day that does not exist", { startDate: "2026-02-31", dueDate: null }, false],
    ["text", { startDate: "soon", dueDate: "2026-11-12" }, false]
  ] as const)("an order with %s is valid: %s", (_, order, expected) => {
    expect(planningOrderDatesAreValid(order)).toBe(expected);
  });
});

describe("classifyPlanningOrders", () => {
  it("sorts each order by its place in the list, a bad date before a late one", () => {
    expect(
      classifyPlanningOrders(
        [
          { startDate: "2026-11-05", dueDate: "2026-11-12" },
          { startDate: "2026-11-04", dueDate: "2026-11-11" },
          // a bad due date is invalid even with a start in the past
          { startDate: "2026-11-01", dueDate: "2026-02-31" },
          { startDate: null, dueDate: null }
        ],
        "2026-11-05",
        7
      )
    ).toEqual({ invalid: [2], past: [1], placeable: [0, 3] });
  });

  it("is empty for no orders", () => {
    expect(classifyPlanningOrders([], "2026-11-05", 7)).toEqual({
      invalid: [],
      past: [],
      placeable: []
    });
  });
});

describe("pastStartRefusalMessages", () => {
  it("writes one message per item, counting across its segments", () => {
    const messages = pastStartRefusalMessages(
      [
        { itemId: "i1", planningSegmentId: "", index: 0 },
        { itemId: "i1", planningSegmentId: "proj1", index: 0 },
        { itemId: "i2", planningSegmentId: "", index: 3 }
      ],
      (itemId) => `P-${itemId}`,
      "2026-11-05"
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("2 orders for P-i1");
    expect(messages[1]).toContain("1 order for P-i2");
  });
});

describe("withoutRowDraft", () => {
  const drafts = { item1: [1], "item1:proj1": [2] };

  it("drops only the draft of the row's own segment", () => {
    const key = planningRowKey({ id: "item1", planningSegmentId: "proj1" });
    const seeded = { item1: [1], [key]: [2] };
    expect(
      withoutRowDraft(seeded, { id: "item1", planningSegmentId: "proj1" })
    ).toEqual({ item1: [1] });
  });

  it("returns the same object when the row has no draft, so nothing re-renders", () => {
    expect(withoutRowDraft(drafts, { id: "item2" })).toBe(drafts);
  });
});

describe("refusedOrdersOfRow", () => {
  const refused = [
    { itemId: "item1", planningSegmentId: "", index: 0 },
    { itemId: "item1", planningSegmentId: "", index: 2 },
    { itemId: "item1", planningSegmentId: "proj1", index: 1 },
    { itemId: "item2", planningSegmentId: "", index: 1 }
  ];

  it("returns the row's refused orders as sent, by item and segment", () => {
    expect(
      refusedOrdersOfRow({ id: "item1", orders: ["a", "b", "c"] }, refused)
    ).toEqual(["a", "c"]);
    expect(
      refusedOrdersOfRow(
        { id: "item1", planningSegmentId: "proj1", orders: ["a", "b"] },
        refused
      )
    ).toEqual(["b"]);
  });

  it("is empty for a row with no refusal, or no refusals at all", () => {
    expect(refusedOrdersOfRow({ id: "item3", orders: ["a"] }, refused)).toEqual(
      []
    );
    expect(refusedOrdersOfRow({ id: "item1", orders: ["a"] }, undefined)).toEqual(
      []
    );
  });

  it("skips an index the sent orders do not have", () => {
    expect(
      refusedOrdersOfRow({ id: "item2", orders: ["a"] }, refused)
    ).toEqual([]);
  });
});

describe("draftsOfRefusedOrders", () => {
  it("keeps a draft only for the rows with a refused order", () => {
    const refused = [{ itemId: "item1", planningSegmentId: "", index: 1 }];
    expect(
      draftsOfRefusedOrders(
        [
          { id: "item1", planningSegmentId: "", orders: ["a", "b"] },
          { id: "item2", planningSegmentId: "", orders: ["c"] }
        ],
        refused
      )
    ).toEqual({
      [planningRowKey({ id: "item1", planningSegmentId: "" })]: ["b"]
    });
  });
});

// A week's Order / Make action sums its planned orders. The suggestions are
// those planned orders, each naming its id, so the order placed converts the
// planned order it stands for and not a guess by position.
describe("suggestions from the week's planned orders", () => {
  const plannedOrder = (
    overrides: Partial<{
      id: string;
      status: string;
      periodId: string;
      quantity: number;
      dueDate: string;
      releaseDate: string;
      splitIndex: number;
    }> = {}
  ) => ({
    id: "po1",
    status: "Planned",
    periodId: "w1",
    quantity: 6,
    dueDate: "2026-10-06",
    releaseDate: "2026-09-29",
    splitIndex: 0,
    ...overrides
  });
  // the page's weeks; today (2026-09-30) is in the first
  const weeks = [
    { id: "w0", startDate: "2026-09-27", endDate: "2026-10-03" },
    { id: "w1", startDate: "2026-10-04", endDate: "2026-10-10" },
    { id: "w2", startDate: "2026-10-11", endDate: "2026-10-17" }
  ];

  it("offers one job per unconverted planned order of the week, Firm included", () => {
    expect(
      productionOrdersFromActions(
        [
          action({
            type: "Make",
            suggestedQuantity: 24,
            policyName: "Demand-Based Reorder",
            isASAP: false
          })
        ],
        {
          item: { lotSize: 10 },
          todayDate: "2026-09-30",
          weeks,
          plannedOrders: [
            plannedOrder({
              id: "late",
              quantity: 4,
              dueDate: "2026-10-08",
              releaseDate: "2026-10-01",
              splitIndex: 1
            }),
            plannedOrder({ id: "firm", status: "Firm", quantity: 20 }),
            plannedOrder({ id: "done", status: "Converted", quantity: 99 }),
            plannedOrder({
              id: "next-week",
              periodId: "w2",
              quantity: 50,
              dueDate: "2026-10-13"
            })
          ]
        }
      )
    ).toEqual([
      {
        startDate: "2026-09-29",
        dueDate: "2026-10-06",
        periodId: "w1",
        quantity: 20,
        isASAP: true,
        planningActionId: "act1",
        plannedOrderId: "firm",
        policyName: "Demand-Based Reorder"
      },
      {
        startDate: "2026-10-01",
        dueDate: "2026-10-08",
        periodId: "w1",
        quantity: 4,
        isASAP: false,
        planningActionId: "act1",
        plannedOrderId: "late",
        policyName: "Demand-Based Reorder"
      }
    ]);
  });

  it("converts a Buy planned order to whole purchase units", () => {
    const [order] = plannedOrdersFromActions([action({ suggestedQuantity: 25 })], {
      conversionFactor: 12,
      weeks,
      todayDate: "2026-09-30",
      plannedOrders: [plannedOrder({ id: "buy", quantity: 25 })]
    });
    expect(order).toMatchObject({
      quantity: 3,
      startDate: "2026-09-29",
      dueDate: "2026-10-06",
      plannedOrderId: "buy",
      planningActionId: "act1"
    });
  });

  // MRP counts an overdue planned order in the first week, whatever week the
  // row is stored in.
  it("offers the first week's action its overdue planned orders too", () => {
    const orders = productionOrdersFromActions(
      [action({ type: "Make", periodId: "w0", suggestedQuantity: 9 })],
      {
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [
          plannedOrder({
            id: "overdue",
            periodId: "older",
            quantity: 4,
            dueDate: "2026-09-20"
          }),
          plannedOrder({
            id: "this-week",
            periodId: "w0",
            quantity: 5,
            dueDate: "2026-10-02"
          }),
          plannedOrder({ id: "next-week", periodId: "w1" })
        ]
      }
    );
    expect(orders.map((order) => order.plannedOrderId)).toEqual([
      "overdue",
      "this-week"
    ]);
  });

  // After the week turns and before MRP runs again, an action keeps last
  // week's period: what it counted is overdue, and counts in the first week.
  it("offers an action of a week already past the overdue planned orders", () => {
    const orders = productionOrdersFromActions(
      [
        action({
          type: "Make",
          periodId: "last-week",
          suggestedDate: "2026-09-24",
          suggestedQuantity: 4
        })
      ],
      {
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [
          plannedOrder({
            id: "overdue",
            periodId: "last-week",
            quantity: 4,
            dueDate: "2026-09-24",
            releaseDate: "2026-09-20"
          }),
          plannedOrder({ id: "next-week", periodId: "w1" })
        ]
      }
    );
    expect(
      orders.map(({ quantity, periodId, plannedOrderId }) => ({
        quantity,
        periodId,
        plannedOrderId
      }))
    ).toEqual([{ quantity: 4, periodId: "last-week", plannedOrderId: "overdue" }]);
  });

  // Last week's action still stands for what is overdue now; the current
  // week's action stands for its own week. Each order is offered once.
  it("gives last week's action the overdue planned orders and the current week's action its own, when both are open", () => {
    const pastWeek = action({
      id: "past",
      type: "Make",
      periodId: "last-week",
      suggestedDate: "2026-09-24",
      suggestedQuantity: 4
    });
    const thisWeek = action({
      id: "current",
      type: "Make",
      periodId: "w0",
      suggestedQuantity: 5
    });
    const plannedOrders = [
      plannedOrder({
        id: "overdue",
        periodId: "last-week",
        quantity: 4,
        dueDate: "2026-09-24"
      }),
      plannedOrder({
        id: "this-week",
        periodId: "w0",
        quantity: 5,
        dueDate: "2026-10-02"
      })
    ];
    const offered = (actions: Action[]) =>
      productionOrdersFromActions(actions, {
        todayDate: "2026-09-30",
        weeks,
        plannedOrders
      }).map(({ planningActionId, plannedOrderId, quantity }) => ({
        planningActionId,
        plannedOrderId,
        quantity
      }));

    expect(offered([pastWeek, thisWeek])).toEqual([
      { planningActionId: "past", plannedOrderId: "overdue", quantity: 4 },
      { planningActionId: "current", plannedOrderId: "this-week", quantity: 5 }
    ]);
    // with no action of last week, the current one counts the overdue order
    expect(offered([{ ...thisWeek, suggestedQuantity: 9 }])).toEqual([
      { planningActionId: "current", plannedOrderId: "overdue", quantity: 4 },
      { planningActionId: "current", plannedOrderId: "this-week", quantity: 5 }
    ]);
  });

  // A dismissed action of last week still counted the overdue orders: the
  // current week's action does not, so it must not offer them.
  it("keeps the overdue planned orders off the current week's action when last week's action was dismissed", () => {
    const orders = productionOrdersFromActions(
      [action({ id: "current", type: "Make", periodId: "w0", suggestedQuantity: 5 })],
      {
        todayDate: "2026-09-30",
        weeks,
        rowActions: [
          {
            type: "Make",
            status: "Dismissed",
            periodId: "last-week",
            suggestedDate: "2026-09-24"
          },
          { type: "Make", status: "Open", periodId: "w0", suggestedDate: "2026-10-01" }
        ],
        plannedOrders: [
          plannedOrder({
            id: "overdue",
            periodId: "last-week",
            quantity: 4,
            dueDate: "2026-09-24"
          }),
          plannedOrder({
            id: "this-week",
            periodId: "w0",
            quantity: 5,
            dueDate: "2026-10-02"
          })
        ]
      }
    );
    expect(
      orders.map(({ plannedOrderId, quantity }) => ({ plannedOrderId, quantity }))
    ).toEqual([{ plannedOrderId: "this-week", quantity: 5 }]);
  });

  // Two weeks turned before MRP ran again: only the latest open past week's
  // action stands for what is overdue now, so each order is offered once.
  it("gives the overdue planned orders only to the latest open past week's action", () => {
    const twoWeeksAgo = action({
      id: "two-weeks-ago",
      type: "Make",
      periodId: "two-weeks-ago",
      suggestedDate: "2026-09-17",
      suggestedQuantity: 4,
      policyName: "Stock Only"
    });
    const lastWeek = action({
      id: "last-week",
      type: "Make",
      periodId: "last-week",
      suggestedDate: "2026-09-24",
      suggestedQuantity: 4,
      policyName: "Stock Only"
    });
    const offered = (
      actions: Action[],
      rowActions?: NonNullable<
        Parameters<typeof productionOrdersFromActions>[1]
      >["rowActions"]
    ) =>
      productionOrdersFromActions(actions, {
        todayDate: "2026-09-30",
        weeks,
        rowActions,
        plannedOrders: [
          plannedOrder({
            id: "overdue",
            periodId: "last-week",
            quantity: 4,
            dueDate: "2026-09-24"
          })
        ]
      }).map(({ planningActionId, plannedOrderId, quantity }) => ({
        planningActionId,
        plannedOrderId,
        quantity
      }));

    // both open: the earlier one is split by its policy, naming no order
    expect(offered([twoWeeksAgo, lastWeek])).toEqual([
      {
        planningActionId: "two-weeks-ago",
        plannedOrderId: undefined,
        quantity: 4
      },
      { planningActionId: "last-week", plannedOrderId: "overdue", quantity: 4 }
    ]);
    // the later one dismissed: the latest OPEN one takes them
    expect(
      offered(
        [twoWeeksAgo],
        [
          {
            type: "Make",
            status: "Dismissed",
            periodId: "last-week",
            suggestedDate: "2026-09-24"
          }
        ]
      )
    ).toEqual([
      { planningActionId: "two-weeks-ago", plannedOrderId: "overdue", quantity: 4 }
    ]);
  });

  it("offers an action of a later week not on the page no planned order", () => {
    const orders = productionOrdersFromActions(
      [
        action({
          type: "Make",
          periodId: "w9",
          suggestedDate: "2026-11-30",
          suggestedQuantity: 6
        })
      ],
      {
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [plannedOrder({ id: "overdue", dueDate: "2026-09-24" })]
      }
    );
    expect(orders.map((order) => order.plannedOrderId)).toEqual([undefined]);
  });

  it("counts a planned order in the week of its due date, not its stored week", () => {
    const orders = productionOrdersFromActions(
      [action({ type: "Make", periodId: "w2", suggestedQuantity: 5 })],
      {
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [
          // stored in w1, due in w2
          plannedOrder({
            id: "moved",
            periodId: "w1",
            quantity: 5,
            dueDate: "2026-10-12"
          }),
          // overdue: the first week's, never a later one's
          plannedOrder({ id: "overdue", periodId: "w2", dueDate: "2026-09-20" }),
          // past the last week: no week's
          plannedOrder({ id: "beyond", periodId: "w2", dueDate: "2026-10-20" })
        ]
      }
    );
    expect(orders.map((order) => order.plannedOrderId)).toEqual(["moved"]);
  });

  // MRP leaves a held order it cancels out of the week's total: offering it
  // would make it again.
  it("leaves out a planned order MRP is cancelling", () => {
    const orders = productionOrdersFromActions(
      [action({ type: "Make", suggestedQuantity: 6 })],
      {
        todayDate: "2026-09-30",
        weeks,
        rowActions: [
          { type: "Cancel", status: "Open", plannedOrderId: "cancelling" },
          // a Cancel already applied is history
          { type: "Cancel", status: "Actioned", plannedOrderId: "kept" }
        ],
        plannedOrders: [
          plannedOrder({ id: "kept" }),
          plannedOrder({
            id: "cancelling",
            status: "Firm",
            quantity: 20,
            splitIndex: 1
          })
        ]
      }
    );
    expect(
      orders.map(({ quantity, plannedOrderId }) => ({ quantity, plannedOrderId }))
    ).toEqual([{ quantity: 6, plannedOrderId: "kept" }]);
  });

  it("splits the action by its policy, naming no planned order, when the week's planned orders do not add up to it", () => {
    const orders = productionOrdersFromActions(
      [action({ type: "Make", suggestedQuantity: 20, policyName: "Demand-Based Reorder" })],
      {
        item: { lotSize: 10 },
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [plannedOrder({ quantity: 6 })]
      }
    );
    expect(
      orders.map(({ quantity, plannedOrderId }) => ({ quantity, plannedOrderId }))
    ).toEqual([
      { quantity: 10, plannedOrderId: undefined },
      { quantity: 10, plannedOrderId: undefined }
    ]);
  });

  it("splits the action by its policy when its week has no planned order", () => {
    const orders = productionOrdersFromActions(
      [action({ type: "Make", suggestedQuantity: 20, policyName: "Demand-Based Reorder" })],
      {
        item: { lotSize: 10 },
        todayDate: "2026-09-30",
        weeks,
        plannedOrders: [plannedOrder({ periodId: "w2", dueDate: "2026-10-13" })]
      }
    );
    expect(
      orders.map(({ quantity, plannedOrderId }) => ({ quantity, plannedOrderId }))
    ).toEqual([
      { quantity: 10, plannedOrderId: undefined },
      { quantity: 10, plannedOrderId: undefined }
    ]);
  });
});

// MRP re-plans after an Apply that changed a planned order: those rows'
// drafts were built from the old actions and planned orders.
describe("rowsReplannedByApply", () => {
  const change = (
    id: string,
    overrides: Partial<{
      itemId: string;
      planningSegmentId: string | null;
      plannedOrderId: string | null;
    }> = {}
  ) => ({
    id,
    itemId: "item1",
    planningSegmentId: "",
    plannedOrderId: "po1",
    ...overrides
  });

  it("names each row of an applied action on a planned order once", () => {
    expect(
      rowsReplannedByApply(
        [
          change("a1"),
          change("a2", { plannedOrderId: "po2" }),
          // on a job, not a planned order: no re-plan
          change("a3", { itemId: "item2", plannedOrderId: null }),
          // refused: not applied
          change("a4", { itemId: "item3" }),
          change("a5", { itemId: "item4", planningSegmentId: null })
        ],
        ["a1", "a2", "a3", "a5"]
      )
    ).toEqual([
      { id: "item1", planningSegmentId: "" },
      { id: "item4", planningSegmentId: null }
    ]);
  });
});
