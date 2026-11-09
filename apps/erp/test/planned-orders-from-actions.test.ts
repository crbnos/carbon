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
  refusedOrdersOfRow,
  supplierConversionFactor,
  withoutRowDraft
} from "../app/modules/production/ui/Planning/planned-orders-from-actions";

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
