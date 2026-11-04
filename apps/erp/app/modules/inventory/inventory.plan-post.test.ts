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

// A tracked entity counted short in one bin and found in another moved: the
// matched quantity is a move, not a write-off plus a new unit.
it("pairs a serial missing in one bin and found in another into a move", () => {
  const lines = [
    line({
      id: "a1",
      trackedEntityId: "U",
      storageUnitId: "A1",
      systemQuantity: 1,
      countedQuantity: 0
    }),
    line({
      id: "b2",
      trackedEntityId: "U",
      storageUnitId: "B2",
      systemQuantity: 0,
      countedQuantity: 1,
      foundDuringCount: true
    })
  ];
  const plan = planInventoryCountPost(lines);
  expect(plan.moves).toEqual([
    {
      trackedEntityId: "U",
      fromStorageUnitId: "A1",
      toStorageUnitId: "B2",
      quantity: 1
    }
  ]);
  expect(plan.planned.map((p) => p.delta)).toEqual([0, 0]);
});

it("moves the found part of a batch and leaves no delta when it all matches", () => {
  const lines = [
    line({
      id: "a1",
      trackedEntityId: "L",
      storageUnitId: "A1",
      systemQuantity: 10,
      countedQuantity: 6
    }),
    line({
      id: "b2",
      trackedEntityId: "L",
      storageUnitId: "B2",
      systemQuantity: 0,
      countedQuantity: 4,
      foundDuringCount: true
    })
  ];
  const plan = planInventoryCountPost(lines);
  expect(plan.moves).toEqual([
    {
      trackedEntityId: "L",
      fromStorageUnitId: "A1",
      toStorageUnitId: "B2",
      quantity: 4
    }
  ]);
  expect(plan.planned.map((p) => p.delta)).toEqual([0, 0]);
});

it("moves what matches and adjusts the shortfall of a batch", () => {
  const lines = [
    line({
      id: "a1",
      trackedEntityId: "L",
      storageUnitId: "A1",
      systemQuantity: 10,
      countedQuantity: 5
    }),
    line({
      id: "b2",
      trackedEntityId: "L",
      storageUnitId: "B2",
      systemQuantity: 0,
      countedQuantity: 3,
      foundDuringCount: true
    })
  ];
  const plan = planInventoryCountPost(lines);
  expect(plan.moves).toEqual([
    {
      trackedEntityId: "L",
      fromStorageUnitId: "A1",
      toStorageUnitId: "B2",
      quantity: 3
    }
  ]);
  expect(plan.planned.map((p) => p.delta)).toEqual([-2, 0]);
});

it("plans no move for a missing unit with nothing found elsewhere", () => {
  const lines = [
    line({
      id: "a1",
      trackedEntityId: "U",
      storageUnitId: "A1",
      systemQuantity: 1,
      countedQuantity: 0
    })
  ];
  const plan = planInventoryCountPost(lines);
  expect(plan.moves).toEqual([]);
  expect(plan.planned.map((p) => p.delta)).toEqual([-1]);
});

it("plans no move for an untracked line", () => {
  const lines = [
    line({
      id: "a1",
      storageUnitId: "A1",
      systemQuantity: 5,
      countedQuantity: 7
    })
  ];
  const plan = planInventoryCountPost(lines);
  expect(plan.moves).toEqual([]);
  expect(plan.planned.map((p) => p.delta)).toEqual([2]);
});
