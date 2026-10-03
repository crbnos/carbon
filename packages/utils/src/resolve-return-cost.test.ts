// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveReturnUnitCost } from "./resolve-return-cost";

it("single consumption row yields its unit cost", () => {
  // shipment consumed 5 units at total cost 50 (negative rows in the ledger)
  expect(resolveReturnUnitCost([{ quantity: -5, cost: -50 }])).toEqual(10);
});

it("multiple rows yield the weighted average", () => {
  // two layers consumed: 3 @ 10 and 1 @ 30 → (30 + 30) / 4 = 15
  expect(
    resolveReturnUnitCost([
      { quantity: -3, cost: -30 },
      { quantity: -1, cost: -30 }
    ])
  ).toEqual(15);
});

it("sign of the stored rows does not matter", () => {
  expect(
    resolveReturnUnitCost([
      { quantity: 2, cost: 25 },
      { quantity: -2, cost: -25 }
    ])
  ).toEqual(12.5);
});

it("empty rows yield null (caller falls back to current cost)", () => {
  expect(resolveReturnUnitCost([])).toBe(null);
});

it("zero-quantity rows yield null instead of dividing by zero", () => {
  expect(resolveReturnUnitCost([{ quantity: 0, cost: 100 }])).toBe(null);
});

it("non-numeric garbage is treated as zero", () => {
  expect(
    resolveReturnUnitCost([{ quantity: Number.NaN, cost: Number.NaN }])
  ).toBe(null);
});
