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
  openNewSupplyActions,
  plannedOrdersFromActions,
  productionOrdersFromActions,
  supplierConversionFactor
} from "../app/modules/production/ui/Planning/planned-orders-from-actions";

type Action = Parameters<typeof plannedOrdersFromActions>[0][number];

const action = (overrides: Partial<Action> = {}): Action => ({
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
        isASAP: true
      }
    ]);
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
