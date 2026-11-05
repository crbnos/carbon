// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  allocateAcrossBudgets,
  type BinStock,
  chooseSourceBin,
  linesideCredit,
  orderOldFirst,
  type PickedBudget,
  pickFactor,
  planStripedUntrackedDraw,
  recordSharedTakes,
  type SharedTakes,
  sharedTakeKey,
  splitTakeByBin
} from "./picked-consumption.ts";

// A draw of common stock only: every bin's stock counts, whatever its stripe.
const planUntrackedDraw = (args: {
  bins: readonly BinStock[];
  preferredStorageUnitId: string | null;
  quantity: number;
}) =>
  planStripedUntrackedDraw({
    bins: args.bins.map((bin) => ({ ...bin, projectId: null })),
    stripes: [null],
    preferredStorageUnitId: args.preferredStorageUnitId,
    quantity: args.quantity
  }).map(({ storageUnitId, quantity }) => ({ storageUnitId, quantity }));

const budget = (overrides: Partial<PickedBudget>): PickedBudget => {
  const own = overrides.own ?? overrides.available ?? 0;
  const unclaimed = overrides.unclaimed ?? 0;
  return {
    itemId: "OLD",
    projectId: null,
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

it("orderOldFirst puts an item's project stock before its common stock", () => {
  const ordered = orderOldFirst(
    [
      budget({ itemId: "LINE", projectId: null }),
      budget({ itemId: "LINE", projectId: "prj_1" }),
      budget({ itemId: "OLD", isPredecessor: true, projectId: null })
    ],
    "LINE"
  );
  expect(ordered.map((b) => [b.itemId, b.projectId])).toEqual([
    ["OLD", null],
    ["LINE", "prj_1"],
    ["LINE", null]
  ]);
});

it("recordSharedTakes keeps each stripe's shared take apart", () => {
  const takenShared: SharedTakes = new Map();
  const { takes } = allocateAcrossBudgets(5, [
    budget({ itemId: "X", projectId: "prj_1", own: 0, unclaimed: 2 }),
    budget({ itemId: "X", projectId: null, own: 0, unclaimed: 10 })
  ]);
  recordSharedTakes(takenShared, takes);
  expect(takenShared.get(sharedTakeKey("X", "shelf", "prj_1"))).toEqual(2);
  expect(takenShared.get(sharedTakeKey("X", "shelf", null))).toEqual(3);
  expect(takes.map((t) => t.budget.projectId)).toEqual(["prj_1", null]);
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

const bin = (
  storageUnitId: string | null,
  quantity: number,
  nettable = true
) => ({ storageUnitId, quantity, nettable });

it("planUntrackedDraw takes from the preferred bin when it has enough", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", 10), bin("B", 50)],
      preferredStorageUnitId: "A",
      quantity: 4
    })
  ).toEqual([{ storageUnitId: "A", quantity: 4 }]);
});

it("planUntrackedDraw takes from no storage unit when the named bin is empty", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", 0), bin(null, 61)],
      preferredStorageUnitId: "A",
      quantity: 1
    })
  ).toEqual([{ storageUnitId: null, quantity: 1 }]);
});

it("planUntrackedDraw takes from a bin before no storage unit when no bin is named", () => {
  expect(
    planUntrackedDraw({
      bins: [bin(null, 0), bin("B", 49)],
      preferredStorageUnitId: null,
      quantity: 1
    })
  ).toEqual([{ storageUnitId: "B", quantity: 1 }]);
});

it("planUntrackedDraw splits a short bin across the fullest others", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", 3), bin("B", 2), bin("C", 10)],
      preferredStorageUnitId: "A",
      quantity: 8
    })
  ).toEqual([
    { storageUnitId: "A", quantity: 3 },
    { storageUnitId: "C", quantity: 5 }
  ]);
});

it("planUntrackedDraw never guesses a non-nettable bin", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("QUARANTINE", 49, false), bin("B", 1)],
      preferredStorageUnitId: null,
      quantity: 2
    })
  ).toEqual([{ storageUnitId: "B", quantity: 2 }]);
});

it("planUntrackedDraw uses a non-nettable bin when it is the one named", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("QUARANTINE", 49, false)],
      preferredStorageUnitId: "QUARANTINE",
      quantity: 2
    })
  ).toEqual([{ storageUnitId: "QUARANTINE", quantity: 2 }]);
});

it("planUntrackedDraw leaves a real shortfall on the named bin", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", 2), bin("B", 3)],
      preferredStorageUnitId: "A",
      quantity: 10
    })
  ).toEqual([
    { storageUnitId: "A", quantity: 7 },
    { storageUnitId: "B", quantity: 3 }
  ]);
});

it("planUntrackedDraw leaves a shortfall on no storage unit when nothing holds stock", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", -2)],
      preferredStorageUnitId: null,
      quantity: 16
    })
  ).toEqual([{ storageUnitId: null, quantity: 16 }]);
});

it("planUntrackedDraw sums rows of one bin", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("A", 1), bin("A", 2), bin("B", 2.5)],
      preferredStorageUnitId: null,
      quantity: 3
    })
  ).toEqual([{ storageUnitId: "A", quantity: 3 }]);
});

it("chooseSourceBin keeps the preferred bin when it holds the quantity", () => {
  expect(
    chooseSourceBin({
      bins: [bin("A", 5), bin("B", 50)],
      preferredStorageUnitId: "A",
      quantity: 5
    })
  ).toBe("A");
});

it("chooseSourceBin picks the bin with the stock when no bin is named", () => {
  expect(
    chooseSourceBin({
      bins: [bin(null, 0), bin("B", 50)],
      preferredStorageUnitId: null,
      quantity: 1
    })
  ).toBe("B");
});

it("chooseSourceBin keeps no storage unit when it holds the quantity", () => {
  expect(
    chooseSourceBin({
      bins: [bin(null, 61), bin("A", 0)],
      preferredStorageUnitId: null,
      quantity: 1
    })
  ).toBeNull();
});

it("chooseSourceBin prefers a bin that covers the quantity over a fuller short one", () => {
  expect(
    chooseSourceBin({
      bins: [bin("A", 1), bin("B", 4), bin("C", 3)],
      preferredStorageUnitId: "A",
      quantity: 3
    })
  ).toBe("B");
});

it("chooseSourceBin skips quarantine and falls back to the fullest short bin", () => {
  expect(
    chooseSourceBin({
      bins: [bin("QUARANTINE", 49, false), bin("A", 2)],
      preferredStorageUnitId: null,
      quantity: 5
    })
  ).toBe("A");
});

it("chooseSourceBin keeps the preferred bin when nothing holds stock", () => {
  expect(
    chooseSourceBin({
      bins: [],
      preferredStorageUnitId: "A",
      quantity: 5
    })
  ).toBe("A");
});

it("planUntrackedDraw takes from no storage unit too when no bin is named", () => {
  expect(
    planUntrackedDraw({
      bins: [bin("B", 8), bin(null, 3), bin("QUARANTINE", 20, false)],
      preferredStorageUnitId: null,
      quantity: 20
    })
  ).toEqual([
    { storageUnitId: "B", quantity: 17 },
    { storageUnitId: null, quantity: 3 }
  ]);
});

const projectBin = (
  storageUnitId: string | null,
  projectId: string | null,
  quantity: number
) => ({ storageUnitId, projectId, quantity, nettable: true });

it("planStripedUntrackedDraw takes the project's stock in every bin before common stock", () => {
  expect(
    planStripedUntrackedDraw({
      bins: [projectBin("A", null, 10), projectBin("B", "P1", 5)],
      stripes: ["P1", null],
      preferredStorageUnitId: null,
      quantity: 5
    })
  ).toEqual([{ storageUnitId: "B", projectId: "P1", quantity: 5 }]);
});

it("planStripedUntrackedDraw takes common stock for what the project's stock lacks", () => {
  expect(
    planStripedUntrackedDraw({
      bins: [
        projectBin("A", null, 10),
        projectBin("B", "P1", 3),
        projectBin("A", "P1", 1)
      ],
      stripes: ["P1", null],
      preferredStorageUnitId: "A",
      quantity: 8
    })
  ).toEqual([
    { storageUnitId: "A", projectId: "P1", quantity: 1 },
    { storageUnitId: "B", projectId: "P1", quantity: 3 },
    { storageUnitId: "A", projectId: null, quantity: 4 }
  ]);
});

it("planStripedUntrackedDraw leaves a shortfall on the common stripe of the named bin", () => {
  expect(
    planStripedUntrackedDraw({
      bins: [projectBin("B", "P1", 2)],
      stripes: ["P1", null],
      preferredStorageUnitId: "A",
      quantity: 5
    })
  ).toEqual([
    { storageUnitId: "B", projectId: "P1", quantity: 2 },
    { storageUnitId: "A", projectId: null, quantity: 3 }
  ]);
});

it("planStripedUntrackedDraw with common stock only plans as planUntrackedDraw does", () => {
  const bins = [bin("A", 1), bin("B", 4), bin(null, 2), bin("Q", 9, false)];
  expect(
    planStripedUntrackedDraw({
      bins,
      stripes: [null],
      preferredStorageUnitId: "A",
      quantity: 9
    }).map(({ storageUnitId, quantity }) => ({ storageUnitId, quantity }))
  ).toEqual(
    planUntrackedDraw({ bins, preferredStorageUnitId: "A", quantity: 9 })
  );
});

it("chooseSourceBin picks no storage unit over a short preferred bin", () => {
  expect(
    chooseSourceBin({
      bins: [bin("A", 1), bin(null, 5)],
      preferredStorageUnitId: "A",
      quantity: 3
    })
  ).toBeNull();
});
