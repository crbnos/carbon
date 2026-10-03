// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveMaintenanceReturnCost } from "./maintenance-return-cost";

it("a full return reverses at the issued unit cost", () => {
  expect(
    resolveMaintenanceReturnCost([{ quantity: -4, cost: -30 }], 4)
  ).toEqual({ quantity: 4, unitCost: 7.5 });
});

it("two issues of the item blend into one unit cost", () => {
  expect(
    resolveMaintenanceReturnCost(
      [
        { quantity: -2, cost: -10 },
        { quantity: -2, cost: -14 }
      ],
      1
    )
  ).toEqual({ quantity: 1, unitCost: 6 });
});

it("earlier returns reduce what is left to reverse", () => {
  expect(
    resolveMaintenanceReturnCost(
      [
        { quantity: -5, cost: -50 },
        { quantity: 3, cost: 30 }
      ],
      5
    )
  ).toEqual({ quantity: 2, unitCost: 10 });
});

it("an issue with no cost row (posted before valuation) returns nothing", () => {
  expect(resolveMaintenanceReturnCost([], 3)).toEqual(null);
});

it("a fully returned issue has nothing left to reverse", () => {
  expect(
    resolveMaintenanceReturnCost(
      [
        { quantity: -2, cost: -8 },
        { quantity: 2, cost: 8 }
      ],
      2
    )
  ).toEqual(null);
});
