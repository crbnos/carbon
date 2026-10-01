// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { resolveMaintenanceReturnCost } from "./maintenance-return-cost.ts";

Deno.test("a full return reverses at the issued unit cost", () => {
  assertEquals(
    resolveMaintenanceReturnCost([{ quantity: -4, cost: -30 }], 4),
    { quantity: 4, unitCost: 7.5 }
  );
});

Deno.test("two issues of the item blend into one unit cost", () => {
  assertEquals(
    resolveMaintenanceReturnCost(
      [
        { quantity: -2, cost: -10 },
        { quantity: -2, cost: -14 },
      ],
      1
    ),
    { quantity: 1, unitCost: 6 }
  );
});

Deno.test("earlier returns reduce what is left to reverse", () => {
  assertEquals(
    resolveMaintenanceReturnCost(
      [
        { quantity: -5, cost: -50 },
        { quantity: 3, cost: 30 },
      ],
      5
    ),
    { quantity: 2, unitCost: 10 }
  );
});

Deno.test("an issue with no cost row (posted before valuation) returns nothing", () => {
  assertEquals(resolveMaintenanceReturnCost([], 3), null);
});

Deno.test("a fully returned issue has nothing left to reverse", () => {
  assertEquals(
    resolveMaintenanceReturnCost(
      [
        { quantity: -2, cost: -8 },
        { quantity: 2, cost: 8 },
      ],
      2
    ),
    null
  );
});
