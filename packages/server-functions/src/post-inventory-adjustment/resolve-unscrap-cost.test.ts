// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveUnscrapUnitCost } from "./resolve-unscrap-cost";

it("single negative scrap row resolves its unit cost", () => {
  expect(resolveUnscrapUnitCost([{ quantity: -10, cost: -70 }])).toEqual(7);
});

it("multiple rows resolve the blended unit cost", () => {
  expect(
    resolveUnscrapUnitCost([
      { quantity: -10, cost: -70 },
      { quantity: -5, cost: -50 }
    ])
  ).toEqual(8);
});

it("empty rows return null (caller falls back to current cost)", () => {
  expect(resolveUnscrapUnitCost([])).toEqual(null);
});

it("zero-quantity rows return null instead of dividing by zero", () => {
  expect(resolveUnscrapUnitCost([{ quantity: 0, cost: 100 }])).toEqual(null);
});
