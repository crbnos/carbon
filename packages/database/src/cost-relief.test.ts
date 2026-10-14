// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type ReliefChild,
  type ReliefLayer,
  relieveLayers,
  replayReliefs
} from "./cost-relief.ts";

function layer(
  id: string,
  quantity: number,
  cost: number,
  {
    children = [],
    trackedEntityId = null,
    remainingQuantity = quantity
  }: {
    children?: ReliefChild[];
    trackedEntityId?: string | null;
    remainingQuantity?: number;
  } = {}
): ReliefLayer {
  return { id, quantity, cost, remainingQuantity, trackedEntityId, children };
}

function child(id: string, quantity: number, cost: number): ReliefChild {
  return { id, quantity, cost, remainingQuantity: quantity };
}

const anonymous = (quantity: number) => ({ quantity, trackedEntityIds: [] });

describe("relieveLayers", () => {
  // Oldest first: 5 at 8, then 5 at 12.
  const layers = [layer("a", 5, 40), layer("b", 5, 60)];

  it("takes the oldest layer first for a FIFO item", () => {
    const result = relieveLayers(layers, "FIFO", anonymous(6), 100);
    expect(result.totalCost).toBe(52);
    expect(result.layersConsumed).toEqual([
      { layerId: "a", quantity: 5, unitCost: 8 },
      { layerId: "b", quantity: 1, unitCost: 12 }
    ]);
    expect(result.remaining).toEqual(
      new Map([
        ["a", 0],
        ["b", 4]
      ])
    );
  });

  it("takes the newest layer first for a LIFO item", () => {
    const result = relieveLayers(layers, "LIFO", anonymous(6), 100);
    expect(result.totalCost).toBe(68);
    expect(result.layersConsumed.map((consumed) => consumed.layerId)).toEqual([
      "b",
      "a"
    ]);
    expect(result.remaining).toEqual(
      new Map([
        ["b", 0],
        ["a", 4]
      ])
    );
  });

  it("adds the per-unit bump of the adjustment children the units carry", () => {
    // 5 at 8, written up by 1 a unit on its first 3.
    const result = relieveLayers(
      [layer("a", 5, 40, { children: [child("a-up", 3, 3)] })],
      "FIFO",
      anonymous(4),
      100
    );
    // 4 × 8 + 3 × 1.
    expect(result.totalCost).toBe(35);
    expect(result.remaining).toEqual(
      new Map([
        ["a", 1],
        ["a-up", 0]
      ])
    );
  });

  it("relieves a leaving serial unit from its own layer, and others from it last", () => {
    const withUnit = [
      layer("a", 2, 200),
      layer("unit", 1, 60, { trackedEntityId: "unit-1" })
    ];
    expect(
      relieveLayers(
        withUnit,
        "FIFO",
        { quantity: 1, trackedEntityIds: ["unit-1"] },
        0
      ).totalCost
    ).toBe(60);
    expect(
      relieveLayers(
        withUnit,
        "LIFO",
        { quantity: 1, trackedEntityIds: ["unit-2"] },
        0
      ).totalCost
    ).toBe(100);
    expect(relieveLayers(withUnit, "FIFO", anonymous(3), 0).totalCost).toBe(
      260
    );
  });

  it("costs a quantity no layer covers at the fallback unit cost", () => {
    const result = relieveLayers(
      [layer("a", 2, 20, { remainingQuantity: 1 })],
      "FIFO",
      anonymous(3),
      15
    );
    expect(result.totalCost).toBe(40);
    expect(result.remaining).toEqual(new Map([["a", 0]]));
  });

  it("does not change the layers it is given", () => {
    const given = [layer("a", 5, 40, { children: [child("a-up", 5, 5)] })];
    relieveLayers(given, "FIFO", anonymous(5), 0);
    expect(given[0]!.remainingQuantity).toBe(5);
    expect(given[0]!.children[0]!.remainingQuantity).toBe(5);
  });
});

describe("replayReliefs", () => {
  it("opens each layer in turn and relieves each quantity against what is open then", () => {
    const { costByKey, remainingById } = replayReliefs({
      events: [
        { kind: "layer", itemId: "part", layer: layer("a", 2, 20) },
        {
          kind: "relief",
          key: "ship-1",
          itemId: "part",
          quantity: 3,
          trackedEntityIds: []
        },
        { kind: "layer", itemId: "part", layer: layer("b", 4, 60) },
        {
          kind: "relief",
          key: "ship-2",
          itemId: "part",
          quantity: 3,
          trackedEntityIds: []
        }
      ],
      methodByItem: new Map([["part", "LIFO"]]),
      fallbackUnitCostByItem: new Map([["part", 11]])
    });
    // 2 × 10 + 1 × 11 before b opened; then LIFO takes 3 of b at 15.
    expect(costByKey).toEqual(
      new Map([
        ["ship-1", 31],
        ["ship-2", 45]
      ])
    );
    expect(remainingById).toEqual(
      new Map([
        ["a", 0],
        ["b", 1]
      ])
    );
  });

  it("refuses an item with no costing method", () => {
    expect(() =>
      replayReliefs({
        events: [
          {
            kind: "relief",
            key: "ship-1",
            itemId: "part",
            quantity: 1,
            trackedEntityIds: []
          }
        ],
        methodByItem: new Map(),
        fallbackUnitCostByItem: new Map([["part", 1]])
      })
    ).toThrow("Item part has no costing method");
  });
});
