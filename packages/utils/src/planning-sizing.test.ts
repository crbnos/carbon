// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { PlanningSizingParams } from "./planning-sizing";
import {
  computePlanningOrders,
  lotSizeBatches,
  orderSizingRules,
  reducedOrderQuantity,
  splitIntoOrders
} from "./planning-sizing";

const params = (
  overrides: Partial<PlanningSizingParams> = {}
): PlanningSizingParams => ({
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
  ...overrides
});

const weeklyPeriods = (startDates: string[]) =>
  startDates.map((startDate, i) => ({ id: `p${i + 1}`, startDate }));

const TODAY = "2026-09-11";

describe("computePlanningOrders", () => {
  it("Manual Reorder returns no orders", () => {
    expect(
      computePlanningOrders({
        reorderingPolicy: "Manual Reorder",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [-50],
        todayDate: TODAY,
        params: params({ reorderPoint: 10 })
      })
    ).toEqual([]);
  });

  it("unknown policy returns no orders", () => {
    expect(
      computePlanningOrders({
        reorderingPolicy: "Bogus",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [-50],
        todayDate: TODAY,
        params: params()
      })
    ).toEqual([]);
  });

  describe("Demand-Based Reorder", () => {
    it("sizes to end-of-window shortfall and dates at the first dip", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods([
          "2026-10-05",
          "2026-10-12",
          "2026-10-19",
          "2026-10-26"
        ]),
        projections: [8, 5, 12, 3],
        todayDate: TODAY,
        params: params({
          demandAccumulationPeriod: 2,
          demandAccumulationSafetyStock: 10
        })
      });

      // Window 1 (p1-p2): dip at p1 (8 < 10), end-of-window 5 → order 5 at p1.
      // Window 2 (p3-p4): +5 already ordered → 17, 8; dip at p4, end 8 → order 2.
      expect(orders).toHaveLength(2);
      expect(orders[0]).toMatchObject({
        periodId: "p1",
        dueDate: "2026-10-05",
        startDate: "2026-09-28",
        quantity: 5,
        isASAP: false,
        policyName: "Demand-Based Reorder"
      });
      expect(orders[0]?.triggerValues).toMatchObject({
        projectedStock: 5,
        safetyStock: 10,
        leadTime: 7
      });
      expect(orders[1]).toMatchObject({
        periodId: "p4",
        dueDate: "2026-10-26",
        quantity: 2
      });
    });

    it("skips windows that end at or above safety stock", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods(["2026-10-05", "2026-10-12"]),
        projections: [2, 10], // mid-window dip that recovers by window end
        todayDate: TODAY,
        params: params({
          demandAccumulationPeriod: 2,
          demandAccumulationSafetyStock: 10
        })
      });
      expect(orders).toEqual([]);
    });

    // The form refuses 0, but an import or API write can store it, and a
    // step of 0 never ended the window loop — the planning page hung.
    it("treats a stored accumulation period of 0 (or null) as one week", () => {
      for (const demandAccumulationPeriod of [0, Number.NaN]) {
        const orders = computePlanningOrders({
          reorderingPolicy: "Demand-Based Reorder",
          periods: weeklyPeriods(["2026-10-05", "2026-10-12"]),
          projections: [-5, -5],
          todayDate: TODAY,
          params: params({ demandAccumulationPeriod })
        });
        expect(orders.map((o) => o.periodId)).toEqual(["p1"]);
        expect(orders[0]?.quantity).toBe(5);
      }
    });

    it("applies max OQ, min OQ, and order multiple", () => {
      // Shortfall 100, capped to maxOQ 30
      const capped = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [0],
        todayDate: TODAY,
        params: params({
          demandAccumulationSafetyStock: 100,
          maximumOrderQuantity: 30
        })
      });
      expect(capped[0]?.quantity).toBe(30);

      // Shortfall 7, rounded up to multiple 5 → 10
      const multiple = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [3],
        todayDate: TODAY,
        params: params({
          demandAccumulationSafetyStock: 10,
          orderMultiple: 5
        })
      });
      expect(multiple[0]?.quantity).toBe(10);

      // Shortfall 2, floored to min OQ 6
      const minimum = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [8],
        todayDate: TODAY,
        params: params({
          demandAccumulationSafetyStock: 10,
          minimumOrderQuantity: 6
        })
      });
      expect(minimum[0]?.quantity).toBe(6);
    });

    it("splits into lot-size batches with spread due dates", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [5],
        todayDate: TODAY,
        params: params({
          demandAccumulationSafetyStock: 30, // shortfall 25, lot 10 → 10, 10, 5
          lotSize: 10
        })
      });
      expect(orders.map((o) => o.quantity)).toEqual([10, 10, 5]);
      // offsets: floor(0*7/3)=0, floor(7/3)=2, floor(14/3)=4
      expect(orders.map((o) => o.dueDate)).toEqual([
        "2026-10-05",
        "2026-10-07",
        "2026-10-09"
      ]);
    });
  });

  describe("Fixed Reorder Quantity", () => {
    it("orders reorderQuantity per day until the reorder point is covered", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Fixed Reorder Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [3],
        todayDate: TODAY,
        params: params({ reorderPoint: 10, reorderQuantity: 4, leadTime: 3 })
      });
      // 3 → +4 (=7) → +4 (=11 ≥ 10) stop
      expect(orders.map((o) => o.quantity)).toEqual([4, 4]);
      expect(orders.map((o) => o.dueDate)).toEqual([
        "2026-10-05",
        "2026-10-06"
      ]);
      expect(orders[0]?.startDate).toBe("2026-10-02");
      expect(orders[0]?.triggerValues).toMatchObject({
        projectedStock: 3,
        reorderPoint: 10,
        reorderQuantity: 4
      });
    });

    it("falls back to reorderPoint as the order quantity when reorderQuantity is 0", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Fixed Reorder Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [3],
        todayDate: TODAY,
        params: params({ reorderPoint: 10, reorderQuantity: 0 })
      });
      expect(orders.map((o) => o.quantity)).toEqual([10]);
    });

    // Both settings at their default 0 on a short item ordered 0, five times
    // per short week, and every one became an "Order 0" planning action.
    it("suggests nothing when both the reorder point and quantity are 0", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Fixed Reorder Quantity",
        periods: weeklyPeriods(["2026-10-05", "2026-10-12"]),
        projections: [-20, -20],
        todayDate: TODAY,
        params: params({ reorderPoint: 0, reorderQuantity: 0 })
      });
      expect(orders).toEqual([]);
    });
  });

  describe("Maximum Quantity", () => {
    it("orders up to maximum inventory", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Maximum Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [2],
        todayDate: TODAY,
        params: params({
          reorderPoint: 5,
          reorderQuantity: 1,
          maximumInventoryQuantity: 20
        })
      });
      expect(orders.map((o) => o.quantity)).toEqual([18]);
    });

    it("applies order multiple and max OQ clamps", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Maximum Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [2],
        todayDate: TODAY,
        params: params({
          reorderPoint: 5,
          reorderQuantity: 1,
          maximumInventoryQuantity: 20,
          orderMultiple: 5
        })
      });
      // required 18 → multiple 5 → 20
      expect(orders.map((o) => o.quantity)).toEqual([20]);
    });
  });

  describe("isASAP", () => {
    it("is true only when the start date is strictly before today", () => {
      const base = {
        reorderingPolicy: "Fixed Reorder Quantity",
        periods: weeklyPeriods(["2026-09-15"]),
        projections: [0],
        params: params({ reorderPoint: 1, reorderQuantity: 5, leadTime: 4 })
      };
      // startDate = 2026-09-11
      const onToday = computePlanningOrders({
        ...base,
        todayDate: "2026-09-11"
      });
      expect(onToday[0]?.isASAP).toBe(false);

      const afterToday = computePlanningOrders({
        ...base,
        todayDate: "2026-09-12"
      });
      expect(afterToday[0]?.isASAP).toBe(true);
    });
  });

  describe("parity with SQL calculate_quantity_to_order (hand-computed literals)", () => {
    // Each expected total below is the scalar the SQL function
    // (20260324120000_planning-quantity-to-order.sql) returns for the same
    // inputs, derived by hand from its branch logic. If this block fails after
    // a change here, the SQL and this module have diverged — fix the drift,
    // never the literals.
    const total = (orders: { quantity: number }[]) =>
      orders.reduce((sum, o) => sum + o.quantity, 0);

    it("DBR windows accumulate like the SQL loop", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Demand-Based Reorder",
        periods: weeklyPeriods([
          "2026-10-05",
          "2026-10-12",
          "2026-10-19",
          "2026-10-26"
        ]),
        projections: [8, 5, 12, 3],
        todayDate: TODAY,
        params: params({
          demandAccumulationPeriod: 2,
          demandAccumulationSafetyStock: 10
        })
      });
      expect(total(orders)).toBe(7); // SQL: window1 → 5, window2 → 2
    });

    it("FRQ loops to cover the reorder point", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Fixed Reorder Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [3],
        todayDate: TODAY,
        params: params({ reorderPoint: 10, reorderQuantity: 4 })
      });
      expect(total(orders)).toBe(8); // SQL: 4 + 4
    });

    it("Maximum Quantity tops up to the maximum with clamps", () => {
      const orders = computePlanningOrders({
        reorderingPolicy: "Maximum Quantity",
        periods: weeklyPeriods(["2026-10-05"]),
        projections: [2],
        todayDate: TODAY,
        params: params({
          reorderPoint: 5,
          reorderQuantity: 1,
          maximumInventoryQuantity: 20,
          orderMultiple: 5
        })
      });
      expect(total(orders)).toBe(20); // SQL: ceil(18/5)*5
    });
  });
});

describe("lotSizeBatches", () => {
  it("splits into full batches with the remainder last, spread across the week", () => {
    expect(lotSizeBatches(120, 50)).toEqual([
      { quantity: 50, dayOffset: 0 },
      { quantity: 50, dayOffset: 2 },
      { quantity: 20, dayOffset: 4 }
    ]);
  });

  it("is one order when it fits in a batch or there is no batch size", () => {
    expect(lotSizeBatches(50, 50)).toEqual([{ quantity: 50, dayOffset: 0 }]);
    expect(lotSizeBatches(120, 0)).toEqual([{ quantity: 120, dayOffset: 0 }]);
  });
});

describe("orderSizingRules", () => {
  const item = {
    reorderPoint: 0,
    reorderQuantity: 0,
    minimumOrderQuantity: 0,
    maximumOrderQuantity: 0,
    orderMultiple: 0,
    lotSize: 0
  };

  it("Demand-Based Reorder: one order per batch, never past batch or max", () => {
    expect(
      orderSizingRules("Demand-Based Reorder", {
        ...item,
        lotSize: 50,
        maximumOrderQuantity: 40,
        minimumOrderQuantity: 5,
        orderMultiple: 10
      })
    ).toEqual({
      perOrder: 50,
      daily: false,
      maximum: 40,
      minimum: 5,
      multiples: [10]
    });
  });

  it("Fixed Reorder Quantity: every order is the fixed quantity", () => {
    expect(
      orderSizingRules("Fixed Reorder Quantity", {
        ...item,
        reorderQuantity: 100
      })
    ).toMatchObject({
      perOrder: 100,
      daily: true,
      maximum: 100,
      multiples: [100]
    });
    // no reorder quantity orders the reorder point
    expect(
      orderSizingRules("Fixed Reorder Quantity", { ...item, reorderPoint: 30 })
    ).toMatchObject({ perOrder: 30, maximum: 30 });
  });

  it("Maximum Quantity: orders up to the maximum, on lot multiples", () => {
    expect(
      orderSizingRules("Maximum Quantity", {
        ...item,
        maximumOrderQuantity: 200,
        lotSize: 50,
        orderMultiple: 1
      })
    ).toEqual({
      perOrder: 200,
      daily: true,
      maximum: 200,
      minimum: 0,
      multiples: [0, 50]
    });
  });

  it("Stock Only and Manual Reorder size by no rule", () => {
    for (const policy of ["Stock Only", "Manual Reorder", null]) {
      expect(
        orderSizingRules(policy, { ...item, lotSize: 50, orderMultiple: 10 })
      ).toEqual({
        perOrder: 0,
        daily: false,
        maximum: 0,
        minimum: 0,
        multiples: []
      });
    }
  });
});

describe("splitIntoOrders", () => {
  it("splits batches across the week", () => {
    expect(splitIntoOrders(120, { perOrder: 50, daily: false })).toEqual([
      { quantity: 50, dayOffset: 0 },
      { quantity: 50, dayOffset: 2 },
      { quantity: 20, dayOffset: 4 }
    ]);
  });

  it("splits daily orders one per day", () => {
    expect(splitIntoOrders(300, { perOrder: 100, daily: true })).toEqual([
      { quantity: 100, dayOffset: 0 },
      { quantity: 100, dayOffset: 1 },
      { quantity: 100, dayOffset: 2 }
    ]);
  });

  it("is the whole quantity with no per-order size", () => {
    expect(splitIntoOrders(300, { perOrder: 0, daily: true })).toEqual([
      { quantity: 300, dayOffset: 0 }
    ]);
  });

  // The split must give back exactly the orders computePlanningOrders sized
  // for the week, or summing them into one action loses them.
  it.each([
    [
      "Fixed Reorder Quantity",
      { reorderPoint: 250, reorderQuantity: 100 },
      [-10]
    ],
    [
      "Maximum Quantity",
      {
        reorderPoint: 400,
        reorderQuantity: 1,
        maximumInventoryQuantity: 500,
        maximumOrderQuantity: 200
      },
      [0]
    ],
    [
      "Demand-Based Reorder",
      { demandAccumulationSafetyStock: 120, lotSize: 50 },
      [0]
    ]
  ] as const)("round-trips the week %s sized", (policy, overrides, projections) => {
    const orders = computePlanningOrders({
      reorderingPolicy: policy,
      periods: weeklyPeriods(["2026-10-05"]),
      projections: [...projections],
      todayDate: TODAY,
      params: params(overrides)
    });
    expect(orders.length).toBeGreaterThan(1);
    const total = orders.reduce((sum, o) => sum + o.quantity, 0);
    expect(
      splitIntoOrders(total, orderSizingRules(policy, params(overrides))).map(
        (o) => o.quantity
      )
    ).toEqual(orders.map((o) => o.quantity));
  });
});

describe("reducedOrderQuantity", () => {
  const rules = { minimum: 0, multiples: [] as number[] };

  it("is the requirement when the item has no order rules", () => {
    expect(reducedOrderQuantity(37, 50, rules)).toBe(37);
  });

  it("rounds up to a whole order multiple", () => {
    expect(reducedOrderQuantity(37, 50, { ...rules, multiples: [10] })).toBe(
      40
    );
  });

  it("rounds up to every multiple in turn", () => {
    expect(
      reducedOrderQuantity(37, 200, { ...rules, multiples: [10, 25] })
    ).toBe(50);
  });

  it("never goes below the minimum order quantity", () => {
    expect(reducedOrderQuantity(12, 50, { ...rules, minimum: 25 })).toBe(25);
  });

  it("never exceeds the order as it stands", () => {
    expect(reducedOrderQuantity(42, 45, { ...rules, multiples: [10] })).toBe(
      45
    );
  });
});
