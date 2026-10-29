// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  allocateAcrossBudgets,
  linesideCredit,
  orderOldFirst,
  type PickedBudget,
  pickFactor,
  recordSharedTakes,
  type SharedTakes,
  sharedTakeKey,
  splitTakeByBin
} from "./picked-consumption.ts";

const budget = (overrides: Partial<PickedBudget>): PickedBudget => {
  const own = overrides.own ?? overrides.available ?? 0;
  const unclaimed = overrides.unclaimed ?? 0;
  return {
    itemId: "OLD",
    factor: 1,
    storageUnitId: "shelf",
    sharedStorageUnitId: "shelf",
    isInventory: true,
    isPredecessor: false,
    ...overrides,
    own,
    unclaimed,
    available: own + unclaimed
  };
};

it("orderOldFirst puts predecessors before the line item, then the rest", () => {
  const ordered = orderOldFirst(
    [
      budget({ itemId: "NEW" }),
      budget({ itemId: "LINE" }),
      budget({ itemId: "OLD", isPredecessor: true })
    ],
    "LINE"
  );
  expect(ordered.map((b) => b.itemId)).toEqual(["OLD", "LINE", "NEW"]);
});

it("allocateAcrossBudgets consumes the predecessor first, then the successor", () => {
  const { takes, remaining } = allocateAcrossBudgets(4, [
    budget({ itemId: "OLD", available: 3 }),
    budget({ itemId: "NEW", available: 1 })
  ]);
  expect(takes.map((t) => [t.budget.itemId, t.quantity])).toEqual([
    ["OLD", 3],
    ["NEW", 1]
  ]);
  expect(remaining).toEqual(0);
});

it("allocateAcrossBudgets converts by the factor and reports the shortfall", () => {
  const { takes, remaining } = allocateAcrossBudgets(4, [
    budget({ itemId: "OLD", available: 2 }),
    budget({ itemId: "NEW", factor: 2, available: 2 })
  ]);
  expect(takes.map((t) => [t.budget.itemId, t.quantity])).toEqual([
    ["OLD", 2],
    ["NEW", 2]
  ]);
  expect(remaining).toEqual(1);
});

it("allocateAcrossBudgets takes a partial completion from the predecessor only", () => {
  const { takes, remaining } = allocateAcrossBudgets(2, [
    budget({ itemId: "OLD", available: 3 }),
    budget({ itemId: "NEW", available: 1 })
  ]);
  expect(takes.map((t) => [t.budget.itemId, t.quantity])).toEqual([["OLD", 2]]);
  expect(remaining).toEqual(0);
});

it("allocateAcrossBudgets with nothing staged leaves everything to the fallback", () => {
  const { takes, remaining } = allocateAcrossBudgets(3, []);
  expect(takes).toEqual([]);
  expect(remaining).toEqual(3);
});

it("pickFactor follows the rule in either direction", () => {
  const rules = new Map([
    ["OLD", { itemId: "OLD", successorItemId: "NEW", conversionFactor: 2 }]
  ]);
  expect(pickFactor({ itemId: "OLD" }, "OLD", rules)).toEqual(1);
  expect(pickFactor({ itemId: "OLD" }, "NEW", rules)).toEqual(2);
  expect(pickFactor({ itemId: "NEW" }, "OLD", rules)).toEqual(0.5);
  expect(
    pickFactor(
      { itemId: "NEW", substitutedFromItemId: "X", substitutionFactor: 4 },
      "X",
      rules
    )
  ).toEqual(0.25);
  expect(pickFactor({ itemId: "NEW" }, "Z", rules)).toEqual(1);
});

it("linesideCredit: own live picks plus what no job's live pick claims", () => {
  const consumedByJob = new Map([["j-old", 3]]);
  const credit = linesideCredit({
    onHand: 4,
    claims: [
      { jobId: "j-old", jobMaterialId: "m-old", staged: 3 },
      { jobId: "j-me", jobMaterialId: "m-me", staged: 2 }
    ],
    consumedByJob,
    jobId: "j-me",
    jobMaterialId: "m-me"
  });
  expect(credit).toEqual({ own: 2, unclaimed: 2 });
});

it("linesideCredit: a cancelled pick leaves its material unclaimed, and the job's consumption reduces its own claim", () => {
  expect(
    linesideCredit({
      onHand: 5,
      claims: [{ jobId: "j-me", jobMaterialId: "m-me", staged: 4 }],
      consumedByJob: new Map([["j-me", 1]]),
      jobId: "j-me",
      jobMaterialId: "m-me"
    })
  ).toEqual({ own: 3, unclaimed: 2 });
  expect(
    linesideCredit({
      onHand: 2,
      claims: [],
      consumedByJob: new Map(),
      jobId: "j",
      jobMaterialId: "m"
    })
  ).toEqual({ own: 0, unclaimed: 2 });
});

it("allocateAcrossBudgets takes a predecessor only in whole assemblies", () => {
  const budgets = [
    budget({
      itemId: "old",
      storageUnitId: "ws",
      available: 3,
      isPredecessor: true
    }),
    budget({ itemId: "new", storageUnitId: "ws", available: 4 })
  ];
  const { takes, remaining } = allocateAcrossBudgets(4, budgets, 2);
  expect(takes.map((t) => [t.budget.itemId, t.quantity])).toEqual([
    ["old", 2],
    ["new", 2]
  ]);
  expect(remaining).toEqual(0);
});

it("allocateAcrossBudgets attributes a take to the own pick first, then the shared stock", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({ itemId: "X", own: 4, unclaimed: 5 })
  ]);
  expect(takes.map((t) => [t.quantity, t.fromOwn, t.fromShared])).toEqual([
    [7, 4, 3]
  ]);
});

it("recordSharedTakes ignores what came from a material's own pick", () => {
  const takenShared: SharedTakes = new Map();
  const { takes } = allocateAcrossBudgets(10, [
    budget({
      itemId: "X",
      own: 10,
      unclaimed: 0,
      sharedStorageUnitId: "lineside"
    })
  ]);
  recordSharedTakes(takenShared, takes);
  expect(takenShared.size).toEqual(0);
});

it("recordSharedTakes accumulates the shared portion per item and bin", () => {
  const takenShared: SharedTakes = new Map();
  const first = allocateAcrossBudgets(6, [
    budget({
      itemId: "X",
      own: 4,
      unclaimed: 5,
      sharedStorageUnitId: "lineside"
    })
  ]);
  recordSharedTakes(takenShared, first.takes);
  const second = allocateAcrossBudgets(1, [
    budget({
      itemId: "X",
      own: 0,
      unclaimed: 3,
      sharedStorageUnitId: "lineside"
    }),
    budget({ itemId: "X", own: 0, unclaimed: 3, sharedStorageUnitId: "other" })
  ]);
  recordSharedTakes(takenShared, second.takes);
  expect(takenShared.get(sharedTakeKey("X", "lineside"))).toEqual(3);
  expect(takenShared.get(sharedTakeKey("X", "other"))).toEqual(undefined);
});

it("a whole-assembly predecessor take still splits own-first", () => {
  const { takes } = allocateAcrossBudgets(
    4,
    [budget({ itemId: "OLD", own: 1, unclaimed: 2, isPredecessor: true })],
    2
  );
  expect(takes.map((t) => [t.quantity, t.fromOwn, t.fromShared])).toEqual([
    [2, 1, 1]
  ]);
});

it("splitTakeByBin writes one row when the pools share a bin", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({
      itemId: "X",
      own: 4,
      unclaimed: 5,
      storageUnitId: "ws",
      sharedStorageUnitId: "ws"
    })
  ]);
  expect(splitTakeByBin(takes[0]!)).toEqual([
    { storageUnitId: "ws", quantity: 7 }
  ]);
});

it("splitTakeByBin charges each pool's own bin when they differ", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({
      itemId: "X",
      own: 4,
      unclaimed: 5,
      storageUnitId: "cart",
      sharedStorageUnitId: "ws"
    })
  ]);
  expect(splitTakeByBin(takes[0]!)).toEqual([
    { storageUnitId: "cart", quantity: 4 },
    { storageUnitId: "ws", quantity: 3 }
  ]);
  const shared = allocateAcrossBudgets(2, [
    budget({
      itemId: "X",
      own: 0,
      unclaimed: 5,
      storageUnitId: "cart",
      sharedStorageUnitId: "ws"
    })
  ]);
  expect(splitTakeByBin(shared.takes[0]!)).toEqual([
    { storageUnitId: "ws", quantity: 2 }
  ]);
});
