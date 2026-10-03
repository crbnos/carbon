// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { computeCurrentUnitCost } from "./post-adjustment-cost";

const layer = (
  quantity: number,
  remainingQuantity: number,
  cost: number,
  appliedChildCost = 0
) => ({ quantity, remainingQuantity, cost, appliedChildCost });

it("Standard items use standardCost", () => {
  expect(
    computeCurrentUnitCost(
      { costingMethod: "Standard", unitCost: 3, standardCost: 5 },
      [layer(100, 100, 1000)]
    )
  ).toEqual(5);
});

it("Average items use unitCost", () => {
  expect(
    computeCurrentUnitCost(
      { costingMethod: "Average", unitCost: 7.25, standardCost: 0 },
      []
    )
  ).toEqual(7.25);
});

it("FIFO uses the weighted average of open layers", () => {
  // 60 remaining @ $10 and 50 remaining @ $12 → (600 + 600) / 110
  expect(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 1, standardCost: 0 },
      [layer(100, 60, 1000), layer(50, 50, 600)]
    )
  ).toEqual(1200 / 110);
});

it("FIFO includes applied adjustment children in the layer cost", () => {
  // base layer qty 100 cost $1000 + $55 applied child → effective $10.55/unit
  expect(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 1, standardCost: 0 },
      [layer(100, 60, 1000, 55)]
    )
  ).toEqual(10.55);
});

it("FIFO falls back to unitCost when no layers are open", () => {
  expect(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 4.5, standardCost: 0 },
      []
    )
  ).toEqual(4.5);
});

it("zero-quantity and fully-consumed layers are skipped", () => {
  expect(
    computeCurrentUnitCost(
      { costingMethod: "LIFO", unitCost: 9, standardCost: 0 },
      [layer(0, 0, 500), layer(10, 0, 100), layer(10, 10, 100)]
    )
  ).toEqual(10);
});
