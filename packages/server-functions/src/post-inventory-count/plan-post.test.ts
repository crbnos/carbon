// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { type PlannableLine, planInventoryCountPost } from "./plan-post";

// Unit tests for the pure planning core: the reconciliation delta math
// (`counted - systemQuantity`). The FOR UPDATE lock, status flip, and serial 0/1
// validation are DB-level and exercised in the browser/integration verification.

type Line = PlannableLine & { postedItemLedgerId: string | null };

const line = (overrides: Partial<Line>): Line => ({
  id: "icl_1",
  itemId: "item_1",
  systemQuantity: 10,
  countedQuantity: 10,
  postedItemLedgerId: null,
  ...overrides
});

it("delta = counted - snapshot (positive)", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 8, countedQuantity: 10 })
  ]);
  expect(planned[0]!.delta).toEqual(2);
});

it("delta is negative when counted is below snapshot", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 5, countedQuantity: 3 })
  ]);
  expect(planned[0]!.delta).toEqual(-2);
});

it("delta is 0 when counted matches the snapshot", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 7, countedQuantity: 7 })
  ]);
  expect(planned[0]!.delta).toEqual(0);
});

it("reconciliation posts the reviewed variance, not counted - live", () => {
  // Snapshot 10, counter found 8 (−2). A +5 receipt landed since the snapshot;
  // the delta must still be −2 (applied on top of the receipt), NOT 8 − 15.
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 10, countedQuantity: 8 })
  ]);
  expect(planned[0]!.delta).toEqual(-2);
});

it("string NUMERIC quantities are coerced", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: "8", countedQuantity: "10.5" })
  ]);
  expect(planned[0]!.delta).toEqual(2.5);
});

it("the full line is preserved on the plan (e.g. postedItemLedgerId)", () => {
  const { planned } = planInventoryCountPost([
    line({
      systemQuantity: 12,
      countedQuantity: 8,
      postedItemLedgerId: "il_orig"
    })
  ]);
  expect(planned[0]!.delta).toEqual(-4);
  expect(planned[0]!.line.postedItemLedgerId).toEqual("il_orig");
});

it("plans every line", () => {
  const { planned } = planInventoryCountPost([
    line({ id: "a", systemQuantity: 5, countedQuantity: 5 }),
    line({ id: "b", systemQuantity: 5, countedQuantity: 9 }),
    line({ id: "c", systemQuantity: 5, countedQuantity: 1 })
  ]);
  expect(planned.map((p) => p.delta)).toEqual([0, 4, -4]);
});
