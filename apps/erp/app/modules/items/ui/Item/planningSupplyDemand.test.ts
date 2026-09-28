import { describe, expect, it } from "vitest";
import type { PlannedOrder } from "../../../purchasing/purchasing.models";
import {
  existingRowId,
  mergePlannedOrders,
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
