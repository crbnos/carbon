// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  resolveMaintenanceReturnCost,
  returnableIssueRows
} from "../../../app/modules/inventory/inventory.service";

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

it("a serial's return reads only that serial's rows", () => {
  const rows = [
    { quantity: -1, cost: -70, trackedEntityId: "a" },
    { quantity: -1, cost: -100, trackedEntityId: "b" }
  ];
  expect(
    resolveMaintenanceReturnCost(returnableIssueRows(rows, "b"), 1)
  ).toEqual({ quantity: 1, unitCost: 100 });
});

it("a lot whose cost rows name no entity reads every row of the item", () => {
  const rows = [
    { quantity: -2, cost: -20, trackedEntityId: null },
    { quantity: -2, cost: -40, trackedEntityId: null }
  ];
  expect(returnableIssueRows(rows, "lot")).toEqual(rows);
});
