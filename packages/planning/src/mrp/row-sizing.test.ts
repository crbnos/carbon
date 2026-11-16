// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type PlanningPolicyRow,
  type RowSizingInput,
  sizeRowSupply
} from "./row-sizing";

const PERIODS = [
  { id: "p1", startDate: "2026-10-05" },
  { id: "p2", startDate: "2026-10-12" },
  { id: "p3", startDate: "2026-10-19" },
  { id: "p4", startDate: "2026-10-26" },
  { id: "p5", startDate: "2026-11-02" }
];

function base(
  overrides: Omit<Partial<RowSizingInput>, "policy"> & {
    policy?: Partial<PlanningPolicyRow>;
  } = {}
): RowSizingInput {
  const { policy, ...rest } = overrides;
  return {
    kind: "Order",
    isProjectSegment: false,
    supersessionMode: null,
    quantityToOrder: 0,
    minimumReserveQuantity: 0,
    quantityOnHand: 0,
    onHand: 0,
    draws: [],
    periods: PERIODS,
    projections: [0, 0, 0, 0, 0],
    demandByPeriod: new Map(),
    openOrders: [],
    preferredSupplierId: "sup-1",
    toleranceDays: 7,
    todayDate: "2026-09-11",
    ...rest,
    policy: {
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
      leadTime: 0,
      ...policy
    }
  };
}

const newOrder = {
  type: "Order",
  purchaseOrderLineId: null,
  jobId: null,
  plannedOrderId: null,
  requiresManualAction: false,
  supplierId: "sup-1",
  isASAP: false,
  reason: null
} as const;

describe("sizeRowSupply", () => {
  // On-hand 5, need 60 in week 2, reorder point 10, reorder quantity 50.
  // Week 1 ends at 5 (< 10): order 50. Week 2 ends at -55 + 50 = -5 (< 10):
  // order 50 more. Week 3 on ends at 45.
  it("orders whole reorder quantities each week the projection falls below the reorder point", () => {
    const result = sizeRowSupply(
      base({
        onHand: 5,
        demandByPeriod: new Map([["p2", 60]]),
        projections: [5, -55, -55, -55, -55],
        policy: {
          reorderingPolicy: "Fixed Reorder Quantity",
          reorderPoint: 10,
          reorderQuantity: 50,
          leadTime: 3
        }
      })
    );
    expect(result).toEqual({
      changeActions: [],
      newSupply: [
        {
          ...newOrder,
          periodId: "p1",
          suggestedQuantity: 50,
          suggestedDate: "2026-10-05",
          horizonDate: "2026-10-05",
          latestOrderDate: "2026-10-02",
          policyName: "Fixed Reorder Quantity",
          triggerValues: {
            projectedStock: 5,
            reorderPoint: 10,
            reorderQuantity: 50,
            leadTime: 3
          }
        },
        {
          ...newOrder,
          periodId: "p2",
          suggestedQuantity: 50,
          suggestedDate: "2026-10-12",
          horizonDate: "2026-10-12",
          latestOrderDate: "2026-10-09",
          policyName: "Fixed Reorder Quantity",
          triggerValues: {
            projectedStock: -5,
            reorderPoint: 10,
            reorderQuantity: 50,
            leadTime: 3
          }
        }
      ]
    });
  });

  // 25 a week for 4 weeks, one 4-week window, batch size 25: the window is
  // short by 100, made as 4 batches of 25, each due the week it is needed.
  it("splits a Demand-Based Reorder window into lot-size batches due the week each is needed", () => {
    const batch = (periodId: string, date: string) => ({
      ...newOrder,
      periodId,
      suggestedQuantity: 25,
      suggestedDate: date,
      horizonDate: date,
      latestOrderDate: date,
      policyName: "Demand-Based Reorder",
      triggerValues: {
        projectedStock: -100,
        safetyStock: 0,
        lotSize: 25,
        leadTime: 0
      }
    });
    const result = sizeRowSupply(
      base({
        demandByPeriod: new Map([
          ["p1", 25],
          ["p2", 25],
          ["p3", 25],
          ["p4", 25]
        ]),
        projections: [-25, -50, -75, -100, -100],
        policy: { lotSize: 25, demandAccumulationPeriod: 4 }
      })
    );
    expect(result).toEqual({
      changeActions: [],
      newSupply: [
        batch("p1", "2026-10-05"),
        batch("p2", "2026-10-12"),
        batch("p3", "2026-10-19"),
        batch("p4", "2026-10-26")
      ]
    });
  });

  // Need 15 in week 2, an open PO of 10 lands that week: short by 5. The PO
  // is on time and fully needed, so it gets no change action, and the new
  // order of 5 folds into it as one Increase to 15.
  it("folds the shortfall into a same-week open PO as one Increase", () => {
    const result = sizeRowSupply(
      base({
        demandByPeriod: new Map([["p2", 15]]),
        projections: [0, -5, -5, -5, -5],
        openOrders: [
          {
            purchaseOrderLineId: "pol-1",
            quantity: 10,
            dueDate: "2026-10-12",
            requiresManualAction: false
          }
        ]
      })
    );
    expect(result).toEqual({
      changeActions: [],
      newSupply: [
        {
          ...newOrder,
          type: "Increase",
          periodId: "p2",
          suggestedQuantity: 15,
          suggestedDate: "2026-10-12",
          horizonDate: "2026-10-12",
          latestOrderDate: "2026-10-12",
          purchaseOrderLineId: "pol-1",
          supplierId: null,
          policyName: "Demand-Based Reorder",
          reason: "Increase from 10 to cover a shortfall of 5",
          triggerValues: {
            projectedStock: -5,
            safetyStock: 0,
            lotSize: 0,
            leadTime: 0
          }
        }
      ]
    });
  });
});
