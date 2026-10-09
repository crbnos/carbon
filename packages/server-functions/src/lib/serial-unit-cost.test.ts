// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { serialUnitCost, type UnitCostLayer } from "./serial-unit-cost";

const fifo = { costingMethod: "FIFO" as const, unitCost: 100, standardCost: 0 };

const layer = (
  id: string,
  cost: number,
  trackedEntityId: string | null = null,
  remainingQuantity = 1
): UnitCostLayer => ({
  id,
  trackedEntityId,
  quantity: 1,
  cost,
  remainingQuantity
});

describe("serialUnitCost", () => {
  it("values a unit at its own layer before the queue", () => {
    expect(
      serialUnitCost({
        itemCost: fifo,
        layers: [layer("a", 40), layer("b", 60, "SN-1")],
        childrenByLayer: new Map(),
        trackedEntityId: "SN-1"
      })
    ).toEqual(60);
  });

  it("values an unstamped unit at the head of the queue, never another unit's layer", () => {
    expect(
      serialUnitCost({
        itemCost: fifo,
        layers: [layer("b", 60, "SN-1"), layer("a", 40)],
        childrenByLayer: new Map(),
        trackedEntityId: "SN-2"
      })
    ).toEqual(40);
  });

  it("adds the layer's price corrections", () => {
    expect(
      serialUnitCost({
        itemCost: fifo,
        layers: [layer("a", 40)],
        childrenByLayer: new Map([
          ["a", [{ quantity: 1, cost: 5, remainingQuantity: 1 }]]
        ]),
        trackedEntityId: "SN-2"
      })
    ).toEqual(45);
  });

  it("falls back to the item's unit cost when no layer is open", () => {
    expect(
      serialUnitCost({
        itemCost: fifo,
        layers: [layer("a", 40, null, 0)],
        childrenByLayer: new Map(),
        trackedEntityId: "SN-2"
      })
    ).toEqual(100);
  });

  it("values Standard and Average items at the item's cost", () => {
    const args = {
      layers: [layer("a", 40, "SN-1")],
      childrenByLayer: new Map(),
      trackedEntityId: "SN-1"
    };
    expect(
      serialUnitCost({
        ...args,
        itemCost: { costingMethod: "Standard", unitCost: 7, standardCost: 9 }
      })
    ).toEqual(9);
    expect(
      serialUnitCost({
        ...args,
        itemCost: { costingMethod: "Average", unitCost: 7, standardCost: 9 }
      })
    ).toEqual(7);
  });
});
