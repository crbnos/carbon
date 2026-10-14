// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { PlannedOrder } from "../../../purchasing/purchasing.models";
import {
  bucketSupplyByPeriod,
  existingRowId,
  mergePlannedOrders,
  projectedChange,
  type SupplyDemandRow
} from "./planningSupplyDemand";

const poLine: SupplyDemandRow = {
  id: "pol_1",
  sourceType: "Purchase Order",
  quantity: 100,
  dueDate: "2026-09-20",
  documentReadableId: "P000123"
};

const salesLine: SupplyDemandRow = {
  id: "sol_1",
  sourceType: "Sales Order",
  quantity: 40,
  dueDate: "2026-09-18",
  documentReadableId: "S000045"
};

function order(overrides: Partial<PlannedOrder>): PlannedOrder {
  return {
    startDate: "2026-09-11",
    dueDate: "2026-09-20",
    periodId: "period_1",
    quantity: 100,
    ...overrides
  };
}

describe("existingRowId", () => {
  it("prefers the line id, which is what the forecast rows carry", () => {
    expect(
      existingRowId(order({ existingId: "po_1", existingLineId: "pol_1" }))
    ).toBe("pol_1");
  });

  it("falls back to existingId for production, where it already is the job id", () => {
    expect(existingRowId(order({ existingId: "job_1" }))).toBe("job_1");
  });

  it("is undefined for a brand-new suggestion", () => {
    expect(existingRowId(order({}))).toBeUndefined();
  });
});

describe("mergePlannedOrders", () => {
  it("lists a converted PO line once, not as Purchase Order + Planned", () => {
    const converted = order({
      existingId: "po_1",
      existingLineId: "pol_1",
      existingQuantity: 100,
      quantity: 100
    });

    const result = mergePlannedOrders([poLine], [converted], 1, 0);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "pol_1",
      sourceType: "Purchase Order",
      quantity: 100,
      projectedQuantity: 100
    });
    expect(result.some((r) => r.sourceType === "Planned")).toBe(false);
  });

  it("does not double-count the projection with the converted line", () => {
    const converted = order({
      existingId: "po_1",
      existingLineId: "pol_1",
      existingQuantity: 100
    });

    const result = mergePlannedOrders([salesLine, poLine], [converted], 1, 10);
    expect(result.map((r) => r.projectedQuantity)).toEqual([-30, 70]);
  });

  it("does not re-convert an existing line's quantity (view already returns inventory units)", () => {
    const edited = order({
      existingId: "po_1",
      existingLineId: "pol_1",
      existingQuantity: 100,
      quantity: 150
    });

    const result = mergePlannedOrders([poLine], [edited], 5, 0);

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(150);
  });

  it("appends a new suggestion as Planned, converted to inventory units", () => {
    const suggestion = order({ quantity: 20, dueDate: "2026-09-25" });

    const result = mergePlannedOrders([poLine], [suggestion], 5, 0);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: null,
      sourceType: "Planned",
      quantity: 100,
      projectedQuantity: 200
    });
  });

  it("still dedupes production orders matched on existingId alone", () => {
    const job: SupplyDemandRow = {
      id: "job_1",
      sourceType: "Production Order",
      quantity: 30,
      dueDate: "2026-09-22",
      documentReadableId: "J000007"
    };
    const existingJob = order({ existingId: "job_1", quantity: 30 });

    const result = mergePlannedOrders([job], [existingJob], 1, 0);

    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe("Production Order");
  });

  it("keeps a planned order whose existing line is no longer open", () => {
    const stale = order({ existingId: "po_9", existingLineId: "pol_9" });

    const result = mergePlannedOrders([poLine], [stale], 1, 0);

    expect(result.map((r) => r.sourceType)).toEqual([
      "Purchase Order",
      "Planned"
    ]);
  });

  it("does not mutate the input rows", () => {
    const rows = [{ ...poLine }];
    const edited = order({ existingLineId: "pol_1", quantity: 999 });

    mergePlannedOrders(rows, [edited], 1, 0);

    expect(rows[0].quantity).toBe(100);
  });
});

describe("bucketSupplyByPeriod", () => {
  const periods = [
    { id: "w1", startDate: "2026-10-11", endDate: "2026-10-17" },
    { id: "w2", startDate: "2026-10-18", endDate: "2026-10-24" }
  ];
  const TODAY = "2026-10-13";

  it("sums the lines of a week per source instead of overwriting", () => {
    expect(
      bucketSupplyByPeriod(periods, TODAY, [
        { sourceType: "Purchase Order", quantity: 100, dueDate: "2026-10-19" },
        { sourceType: "Purchase Order", quantity: 40, dueDate: "2026-10-20" },
        { sourceType: "Production Order", quantity: 7, dueDate: "2026-10-20" }
      ])
    ).toEqual([
      { periodId: "w2", sourceType: "Purchase Order", actualQuantity: 140 },
      { periodId: "w2", sourceType: "Production Order", actualQuantity: 7 }
    ]);
  });

  it("lands an overdue line in the first week and drops one past the horizon", () => {
    expect(
      bucketSupplyByPeriod(periods, TODAY, [
        { sourceType: "Purchase Order", quantity: 5, dueDate: "2026-09-01" },
        { sourceType: "Purchase Order", quantity: 9, dueDate: "2027-01-01" }
      ])
    ).toEqual([
      { periodId: "w1", sourceType: "Purchase Order", actualQuantity: 5 }
    ]);
  });

  it("skips a line with nothing left to receive", () => {
    expect(
      bucketSupplyByPeriod(periods, TODAY, [
        { sourceType: "Purchase Order", quantity: 0, dueDate: "2026-10-19" }
      ])
    ).toEqual([]);
  });
});

describe("projectedChange", () => {
  const week = {
    "Purchase Order": 100,
    "Production Order": 20,
    Planned: 30,
    "Sales Order": -60,
    "Job Material": -10,
    "Demand Forecast": -25
  };

  it("nets every series when none is hidden", () => {
    expect(projectedChange(week, new Set())).toBe(55);
  });

  it("leaves a hidden series out, so the legend is a what-if", () => {
    expect(projectedChange(week, new Set(["planned"]))).toBe(25);
    expect(projectedChange(week, new Set(["supply"]))).toBe(-65);
    expect(projectedChange(week, new Set(["demand", "demandForecast"]))).toBe(
      150
    );
  });
});
