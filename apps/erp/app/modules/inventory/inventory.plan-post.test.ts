// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  type PlannableLine,
  planInventoryCountPost
} from "./inventory.service";

type Line = PlannableLine & { postedItemLedgerId: string | null };

const line = (overrides: Partial<Line>): Line => ({
  id: "icl_1",
  itemId: "item_1",
  systemQuantity: 10,
  countedQuantity: 10,
  postedItemLedgerId: null,
  ...overrides
});

// The delta is counted − snapshot, never counted − live on-hand: a receipt that
// landed after the snapshot must not be reversed by the count.
it("plans each line's delta as counted minus the snapshot, keeping the line", () => {
  const lines = [
    line({ id: "a", systemQuantity: 5, countedQuantity: 5 }),
    line({ id: "b", systemQuantity: 8, countedQuantity: 10 }),
    line({
      id: "c",
      systemQuantity: 12,
      countedQuantity: 8,
      postedItemLedgerId: "il_orig"
    })
  ];
  expect(planInventoryCountPost(lines).planned).toEqual([
    { line: lines[0], delta: 0 },
    { line: lines[1], delta: 2 },
    { line: lines[2], delta: -4 }
  ]);
});

it("coerces NUMERIC quantities that arrive as strings", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: "8", countedQuantity: "10.5" })
  ]);
  expect(planned[0]?.delta).toBe(2.5);
});
