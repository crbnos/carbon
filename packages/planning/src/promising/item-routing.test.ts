// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildItemRouting,
  type ItemMethodMaterial,
  type ItemMethodOperation
} from "./item-routing.ts";

function op(
  o: Partial<ItemMethodOperation> & { id: string; makeMethodId: string }
): ItemMethodOperation {
  return {
    processId: "proc",
    workCenterId: "wc",
    order: 1,
    operationOrder: "After Previous",
    operationType: "Inside",
    description: o.id,
    setupTime: 0.5,
    setupUnit: "Total Hours",
    laborTime: 2,
    laborUnit: "Minutes/Piece",
    machineTime: 0,
    machineUnit: "Minutes/Piece",
    operationLeadTime: null,
    ...o
  };
}

function material(
  m: Partial<ItemMethodMaterial> & {
    id: string;
    makeMethodId: string;
    itemId: string;
  }
): ItemMethodMaterial {
  return {
    itemReadableId: m.itemId,
    methodType: "Make to Order",
    quantity: 1,
    methodOperationId: null,
    ...m
  };
}

describe("buildItemRouting", () => {
  it("gives a sub-assembly used twice its own copy under each parent material", () => {
    const routing = buildItemRouting({
      rootItemId: "TOP",
      activeMethodByItem: new Map([
        ["TOP", "mTOP"],
        ["SUB", "mSUB"]
      ]),
      materialsByMethod: new Map([
        [
          "mTOP",
          [
            material({ id: "a", makeMethodId: "mTOP", itemId: "SUB" }),
            material({
              id: "b",
              makeMethodId: "mTOP",
              itemId: "SUB",
              quantity: 2
            })
          ]
        ]
      ]),
      operationsByMethod: new Map([
        ["mTOP", [op({ id: "assemble", makeMethodId: "mTOP" })]],
        ["mSUB", [op({ id: "cut", makeMethodId: "mSUB" })]]
      ])
    });

    expect(routing?.makeMethods).toEqual([
      { id: "mTOP", parentMaterialId: null },
      { id: "mTOP/mat:a/method", parentMaterialId: "mTOP/mat:a" },
      { id: "mTOP/mat:b/method", parentMaterialId: "mTOP/mat:b" }
    ]);
    expect(routing?.operations.map((o) => o.id)).toEqual([
      "mTOP/op:assemble",
      "mTOP/mat:a/method/op:cut",
      "mTOP/mat:b/method/op:cut"
    ]);
  });

  it("keeps the operation times and links a material to its prefixed operation", () => {
    const routing = buildItemRouting({
      rootItemId: "TOP",
      activeMethodByItem: new Map([["TOP", "mTOP"]]),
      materialsByMethod: new Map([
        [
          "mTOP",
          [
            material({
              id: "bolt",
              makeMethodId: "mTOP",
              itemId: "BOLT",
              methodType: "Purchase to Order",
              methodOperationId: "weld"
            })
          ]
        ]
      ]),
      operationsByMethod: new Map([
        ["mTOP", [op({ id: "weld", makeMethodId: "mTOP", laborTime: 7 })]]
      ])
    });

    expect(routing?.operations[0]).toMatchObject({
      id: "mTOP/op:weld",
      quoteMakeMethodId: "mTOP",
      laborTime: 7,
      setupTime: 0.5,
      operationLeadTime: 0
    });
    expect(routing?.materials[0]?.quoteOperationId).toBe("mTOP/op:weld");
  });

  it("does not explode a Pull from Inventory material that has its own method", () => {
    const routing = buildItemRouting({
      rootItemId: "TOP",
      activeMethodByItem: new Map([
        ["TOP", "mTOP"],
        ["STOCKED", "mSTOCKED"]
      ]),
      materialsByMethod: new Map([
        [
          "mTOP",
          [
            material({
              id: "s",
              makeMethodId: "mTOP",
              itemId: "STOCKED",
              methodType: "Pull from Inventory"
            })
          ]
        ]
      ]),
      operationsByMethod: new Map([
        ["mTOP", [op({ id: "pack", makeMethodId: "mTOP" })]],
        ["mSTOCKED", [op({ id: "mill", makeMethodId: "mSTOCKED" })]]
      ])
    });

    expect(routing?.makeMethods).toHaveLength(1);
    expect(routing?.operations.map((o) => o.id)).toEqual(["mTOP/op:pack"]);
  });

  it("returns null for an item with no operation to schedule", () => {
    expect(
      buildItemRouting({
        rootItemId: "TOP",
        activeMethodByItem: new Map([["TOP", "mTOP"]]),
        materialsByMethod: new Map(),
        operationsByMethod: new Map()
      })
    ).toBeNull();
  });
});
