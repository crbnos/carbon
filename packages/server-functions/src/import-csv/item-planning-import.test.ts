// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildItemIndex } from "./existing-item";
import {
  classifyPlanningRow,
  planningKey,
  planningRuleError,
  readPlanningUpdate,
  type StoredPlanning
} from "./item-planning-import";

describe("planningRuleError (itemPlanningValidator's refinements)", () => {
  const values = (overrides: Partial<StoredPlanning>): StoredPlanning => ({
    reorderingPolicy: "Manual Reorder",
    reorderPoint: 0,
    reorderQuantity: 0,
    maximumInventoryQuantity: 0,
    ...overrides
  });

  it("needs a maximum inventory above a non-zero reorder point for Maximum Quantity", () => {
    const max = "Maximum inventory quantity must be greater than reorder point";
    const policy = "Maximum Quantity";
    expect(
      planningRuleError(
        values({
          reorderingPolicy: policy,
          reorderPoint: 10,
          maximumInventoryQuantity: 50
        })
      )
    ).toBeNull();
    expect(
      planningRuleError(
        values({
          reorderingPolicy: policy,
          reorderPoint: 50,
          maximumInventoryQuantity: 50
        })
      )
    ).toBe(max);
    // The validator tests truthiness, so a reorder point of 0 fails too.
    expect(
      planningRuleError(
        values({
          reorderingPolicy: policy,
          reorderPoint: 0,
          maximumInventoryQuantity: 50
        })
      )
    ).toBe(max);
  });

  it("needs a reorder quantity above 0 for Fixed Reorder Quantity", () => {
    const policy = "Fixed Reorder Quantity";
    expect(
      planningRuleError(
        values({ reorderingPolicy: policy, reorderQuantity: 25 })
      )
    ).toBeNull();
    expect(
      planningRuleError(
        values({ reorderingPolicy: policy, reorderQuantity: 0 })
      )
    ).toBe("Reorder quantity must be greater than 0");
  });

  it("has no rule for the other policies", () => {
    expect(planningRuleError(values({}))).toBeNull();
    expect(
      planningRuleError(values({ reorderingPolicy: "Demand-Based Reorder" }))
    ).toBeNull();
  });
});

describe("readPlanningUpdate", () => {
  it("sets only the columns with a value", () => {
    expect(
      readPlanningUpdate({
        reorderingPolicy: "Demand-Based Reorder",
        demandAccumulationPeriod: "4",
        demandAccumulationSafetyStock: "12.5",
        orderMultiple: "",
        planningHorizonDays: " "
      })
    ).toEqual({
      update: {
        reorderingPolicy: "Demand-Based Reorder",
        demandAccumulationPeriod: 4,
        demandAccumulationSafetyStock: 12.5
      }
    });
    expect(readPlanningUpdate({})).toEqual({ update: {} });
  });

  it("applies the validator's minimums", () => {
    expect(readPlanningUpdate({ demandAccumulationPeriod: "0" })).toEqual({
      error: "Accumulation Period (Weeks) must be 1 or more"
    });
    expect(readPlanningUpdate({ orderMultiple: "0" })).toEqual({
      error: "Order Multiple must be 1 or more"
    });
    expect(readPlanningUpdate({ reorderPoint: "-1" })).toEqual({
      error: "Reorder Point must be 0 or more"
    });
    expect(readPlanningUpdate({ planningHorizonDays: "0" })).toEqual({
      update: { planningHorizonDays: 0 }
    });
  });

  it("refuses a fraction in a whole-number column and text anywhere", () => {
    expect(readPlanningUpdate({ minimumOrderQuantity: "2.5" })).toEqual({
      error: "Minimum Order Quantity must be a whole number"
    });
    expect(readPlanningUpdate({ maximumInventoryQuantity: "2.5" })).toEqual({
      update: { maximumInventoryQuantity: 2.5 }
    });
    expect(readPlanningUpdate({ reorderQuantity: "lots" })).toEqual({
      error: "Reorder Quantity must be a number"
    });
    expect(readPlanningUpdate({ reorderQuantity: "2147483648" })).toEqual({
      error: "Reorder Quantity must be 2147483647 or less"
    });
  });

  it("refuses an unknown reordering policy", () => {
    expect(readPlanningUpdate({ reorderingPolicy: "Kanban" })).toEqual({
      error:
        'Reordering Policy "Kanban" must be one of: Manual Reorder, Demand-Based Reorder, Fixed Reorder Quantity, Maximum Quantity'
    });
  });
});

describe("classifyPlanningRow", () => {
  const itemIndex = buildItemIndex([
    { id: "item-1", readableId: "VALVE-3", revision: "0", type: "Part" },
    { id: "item-2", readableId: "RESIN-A", revision: "0", type: "Material" },
    { id: "item-3", readableId: "PAINT-SVC", revision: "0", type: "Service" }
  ]);
  const stored = new Map<string, StoredPlanning>([
    [
      planningKey("item-1", "loc-east"),
      {
        reorderingPolicy: "Maximum Quantity",
        reorderPoint: 10,
        reorderQuantity: 0,
        maximumInventoryQuantity: 40
      }
    ],
    [
      planningKey("item-2", "loc-east"),
      {
        reorderingPolicy: "Demand-Based Reorder",
        reorderPoint: 0,
        reorderQuantity: 0,
        maximumInventoryQuantity: 0
      }
    ]
  ]);
  const classify = (
    record: Record<string, string>,
    seenKeys = new Set<string>()
  ) => classifyPlanningRow({ record, itemIndex, stored, seenKeys });

  it("updates the columns given, checked against the stored values", () => {
    expect(
      classify({
        readableId: "VALVE-3",
        locationId: "loc-east",
        orderMultiple: "6"
      })
    ).toEqual({
      action: "update",
      itemId: "item-1",
      locationId: "loc-east",
      update: { orderMultiple: 6 }
    });
    // Lowering the maximum to the stored reorder point breaks the rule.
    expect(
      classify({
        readableId: "VALVE-3",
        locationId: "loc-east",
        maximumInventoryQuantity: "10"
      })
    ).toEqual({
      action: "skip",
      category: "error",
      reason: "Maximum inventory quantity must be greater than reorder point"
    });
    // Switching policy needs that policy's own values in the row.
    expect(
      classify({
        readableId: "RESIN-A",
        locationId: "loc-east",
        reorderingPolicy: "Fixed Reorder Quantity"
      })
    ).toMatchObject({ reason: "Reorder quantity must be greater than 0" });
    expect(
      classify({
        readableId: "RESIN-A",
        locationId: "loc-east",
        reorderingPolicy: "Fixed Reorder Quantity",
        reorderQuantity: "200"
      })
    ).toMatchObject({ action: "update" });
  });

  it("skips a row with nothing to set", () => {
    expect(classify({ readableId: "VALVE-3", locationId: "loc-east" })).toEqual(
      {
        action: "skip",
        category: "skipped",
        reason: "No planning values to update"
      }
    );
  });

  it("only updates an existing planning row of an item with a Planning tab", () => {
    expect(
      classify({
        readableId: "VALVE-3",
        locationId: "loc-west",
        orderMultiple: "2"
      })
    ).toMatchObject({
      category: "error",
      reason: "Item VALVE-3 rev 0 has no planning record at this location"
    });
    expect(
      classify({
        readableId: "PAINT-SVC",
        locationId: "loc-east",
        orderMultiple: "2"
      })
    ).toMatchObject({
      category: "error",
      reason:
        "Item PAINT-SVC rev 0 is a Service; this import takes Part, Material, Tool, Consumable items"
    });
    expect(
      classify({ readableId: "VALVE-3", orderMultiple: "2" })
    ).toMatchObject({
      reason: "Missing required Location"
    });
  });

  it("refuses the second row for the same item and location", () => {
    expect(
      classify(
        { readableId: "VALVE-3", locationId: "loc-east", orderMultiple: "2" },
        new Set([planningKey("item-1", "loc-east")])
      )
    ).toMatchObject({
      category: "error",
      reason:
        "Duplicate planning row for VALVE-3 rev 0 at this location in file"
    });
  });
});
