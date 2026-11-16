// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type ItemScanMaterial,
  parseItemCode,
  planItemScanIssue
} from "./itemScan";

describe("parseItemCode", () => {
  it.each([
    ["https://erp.example.app/x/part/item_HZpd242", "item_HZpd242"],
    ["https://other-origin.test/x/material/item_1/details", "item_1"],
    ["https://erp.example.app/x/tool/item_2?tab=x", "item_2"],
    ["https://erp.example.app/x/consumable/item_3", "item_3"]
  ])("reads the item of %s", (input, itemId) => {
    expect(parseItemCode(input)).toBe(itemId);
  });

  it.each([
    "item_HZpd242",
    "https://mes.example.app/x/traveler/te_1",
    "https://erp.example.app/x/part/",
    "https://erp.example.app/x/job/job_1"
  ])("ignores %s", (input) => {
    expect(parseItemCode(input)).toBeNull();
  });
});

describe("planItemScanIssue", () => {
  const base = (
    overrides: Partial<ItemScanMaterial> = {}
  ): ItemScanMaterial => ({
    id: "m1",
    jobOperationId: "op1",
    quantity: 1,
    estimatedQuantity: 5,
    quantityIssued: 0,
    methodType: "Pull from Inventory",
    requiresBatchTracking: false,
    requiresSerialTracking: false,
    ...overrides
  });

  it("sets an untracked material to everything the job requires", () => {
    const material = base({ quantityIssued: 2 });
    expect(planItemScanIssue([material], "op1")).toEqual({
      kind: "untracked",
      material,
      required: 5
    });
  });

  it("issues what a batch material still needs", () => {
    const material = base({ requiresBatchTracking: true, quantityIssued: 2 });
    expect(planItemScanIssue([material], "op1")).toEqual({
      kind: "batch",
      material,
      quantity: 3
    });
  });

  it("issues to this operation's material before one with no operation", () => {
    const unassigned = base({ id: "m0", jobOperationId: null });
    const own = base({ id: "m9" });
    expect(planItemScanIssue([unassigned, own], "op1")).toMatchObject({
      material: own
    });
  });

  it.each([
    base({ requiresSerialTracking: true }),
    base({ methodType: "Make to Order" })
  ])("leaves a serial or made part to the Issue dialog", (material) => {
    expect(planItemScanIssue([material], "op1")).toEqual({
      kind: "dialog",
      material
    });
  });

  it("issues nothing once the job has all of the item", () => {
    expect(planItemScanIssue([base({ quantityIssued: 5 })], "op1")).toEqual({
      kind: "full"
    });
  });

  it("refuses an item only another operation uses", () => {
    expect(planItemScanIssue([base({ jobOperationId: "op2" })], "op1")).toEqual(
      { kind: "notUsed" }
    );
    expect(planItemScanIssue([], "op1")).toEqual({ kind: "notUsed" });
  });
});
