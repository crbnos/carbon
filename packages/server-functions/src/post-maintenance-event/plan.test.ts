// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { diffLaborGroups, type LaborGroup, maintenanceLaborCost } from "./plan";

const WC_A = { dimensionId: "dim-wc", valueId: "wc-a" };
const WC_B = { dimensionId: "dim-wc", valueId: "wc-b" };

function posting(
  reference: string,
  cost: number,
  dimensions = [WC_A]
): LaborGroup[] {
  return [
    { reference, accountId: "6010", dimensions, amount: cost },
    { reference, accountId: "5030", dimensions, amount: -cost }
  ];
}

const sum = (groups: LaborGroup[]) =>
  groups.reduce((total, g) => total + g.amount, 0);

it("cost is hours at the labor rate, never negative", () => {
  expect(maintenanceLaborCost(5400, 40)).toEqual(60);
  expect(maintenanceLaborCost(null, 40)).toEqual(0);
  expect(maintenanceLaborCost(3600, 0)).toEqual(0);
});

it("a new entry posts Dr maintenance / Cr labor absorption", () => {
  const delta = diffLaborGroups(posting("e1", 60), []);
  expect(delta.length).toEqual(2);
  expect(sum(delta)).toEqual(0);
});

it("posting an unchanged entry again is a no-op", () => {
  expect(diffLaborGroups(posting("e1", 60), posting("e1", 60))).toEqual([]);
});

it("an edited duration posts only the adjustment", () => {
  const delta = diffLaborGroups(posting("e1", 80), posting("e1", 60));
  expect(delta.map((g) => [g.accountId, g.amount])).toEqual([
    ["6010", 20],
    ["5030", -20]
  ]);
});

it("a deleted entry reverses what it posted", () => {
  const delta = diffLaborGroups([], posting("e1", 60));
  expect(delta.map((g) => [g.accountId, g.amount])).toEqual([
    ["6010", -60],
    ["5030", 60]
  ]);
});

it("a changed work center reverses the old tags and posts the new", () => {
  const delta = diffLaborGroups(
    posting("e1", 60, [WC_B]),
    posting("e1", 60, [WC_A])
  );
  expect(delta.length).toEqual(4);
  expect(sum(delta)).toEqual(0);
  expect(
    delta
      .filter((g) => g.dimensions[0]?.valueId === "wc-a")
      .map((g) => g.amount)
  ).toEqual([-60, 60]);
});

it("a posting later reversed nets to nothing to undo", () => {
  const prior = [
    ...posting("e1", 60),
    ...posting("e1", 60).map((g) => ({ ...g, amount: -g.amount }))
  ];
  expect(diffLaborGroups([], prior)).toEqual([]);
});
