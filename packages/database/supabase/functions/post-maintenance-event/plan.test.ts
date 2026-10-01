// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  diffLaborGroups,
  type LaborGroup,
  maintenanceLaborCost,
} from "./plan.ts";

const WC_A = { dimensionId: "dim-wc", valueId: "wc-a" };
const WC_B = { dimensionId: "dim-wc", valueId: "wc-b" };

function posting(
  reference: string,
  cost: number,
  dimensions = [WC_A]
): LaborGroup[] {
  return [
    { reference, accountId: "6010", dimensions, amount: cost },
    { reference, accountId: "5030", dimensions, amount: -cost },
  ];
}

const sum = (groups: LaborGroup[]) =>
  groups.reduce((total, g) => total + g.amount, 0);

Deno.test("cost is hours at the labor rate, never negative", () => {
  assertEquals(maintenanceLaborCost(5400, 40), 60);
  assertEquals(maintenanceLaborCost(null, 40), 0);
  assertEquals(maintenanceLaborCost(3600, 0), 0);
});

Deno.test("a new entry posts Dr maintenance / Cr labor absorption", () => {
  const delta = diffLaborGroups(posting("e1", 60), []);
  assertEquals(delta.length, 2);
  assertEquals(sum(delta), 0);
});

Deno.test("posting an unchanged entry again is a no-op", () => {
  assertEquals(diffLaborGroups(posting("e1", 60), posting("e1", 60)), []);
});

Deno.test("an edited duration posts only the adjustment", () => {
  const delta = diffLaborGroups(posting("e1", 80), posting("e1", 60));
  assertEquals(
    delta.map((g) => [g.accountId, g.amount]),
    [
      ["6010", 20],
      ["5030", -20],
    ]
  );
});

Deno.test("a deleted entry reverses what it posted", () => {
  const delta = diffLaborGroups([], posting("e1", 60));
  assertEquals(
    delta.map((g) => [g.accountId, g.amount]),
    [
      ["6010", -60],
      ["5030", 60],
    ]
  );
});

Deno.test("a changed work center reverses the old tags and posts the new", () => {
  const delta = diffLaborGroups(
    posting("e1", 60, [WC_B]),
    posting("e1", 60, [WC_A])
  );
  assertEquals(delta.length, 4);
  assertEquals(sum(delta), 0);
  assertEquals(
    delta
      .filter((g) => g.dimensions[0].valueId === "wc-a")
      .map((g) => g.amount),
    [-60, 60]
  );
});

Deno.test("a posting later reversed nets to nothing to undo", () => {
  const prior = [
    ...posting("e1", 60),
    ...posting("e1", 60).map((g) => ({ ...g, amount: -g.amount })),
  ];
  assertEquals(diffLaborGroups([], prior), []);
});
