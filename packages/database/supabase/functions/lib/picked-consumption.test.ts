import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  allocateAcrossBudgets,
  orderOldFirst,
  type PickedBudget,
  pickFactor,
  linesideCredit,
  recordSharedTakes,
  sharedTakeKey,
  type SharedTakes,
  splitTakeByBin,
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
    available: own + unclaimed,
  };
};

Deno.test("orderOldFirst puts predecessors before the line item, then the rest", () => {
  const ordered = orderOldFirst(
    [
      budget({ itemId: "NEW" }),
      budget({ itemId: "LINE" }),
      budget({ itemId: "OLD", isPredecessor: true }),
    ],
    "LINE"
  );
  assertEquals(
    ordered.map((b) => b.itemId),
    ["OLD", "LINE", "NEW"]
  );
});

Deno.test("allocateAcrossBudgets consumes the predecessor first, then the successor", () => {
  const { takes, remaining } = allocateAcrossBudgets(4, [
    budget({ itemId: "OLD", available: 3 }),
    budget({ itemId: "NEW", available: 1 }),
  ]);
  assertEquals(
    takes.map((t) => [t.budget.itemId, t.quantity]),
    [
      ["OLD", 3],
      ["NEW", 1],
    ]
  );
  assertEquals(remaining, 0);
});

Deno.test("allocateAcrossBudgets converts by the factor and reports the shortfall", () => {
  const { takes, remaining } = allocateAcrossBudgets(4, [
    budget({ itemId: "OLD", available: 2 }),
    budget({ itemId: "NEW", factor: 2, available: 2 }),
  ]);
  assertEquals(
    takes.map((t) => [t.budget.itemId, t.quantity]),
    [
      ["OLD", 2],
      ["NEW", 2],
    ]
  );
  assertEquals(remaining, 1);
});

Deno.test("allocateAcrossBudgets takes a partial completion from the predecessor only", () => {
  const { takes, remaining } = allocateAcrossBudgets(2, [
    budget({ itemId: "OLD", available: 3 }),
    budget({ itemId: "NEW", available: 1 }),
  ]);
  assertEquals(
    takes.map((t) => [t.budget.itemId, t.quantity]),
    [["OLD", 2]]
  );
  assertEquals(remaining, 0);
});

Deno.test("allocateAcrossBudgets with nothing staged leaves everything to the fallback", () => {
  const { takes, remaining } = allocateAcrossBudgets(3, []);
  assertEquals(takes, []);
  assertEquals(remaining, 3);
});

Deno.test("pickFactor follows the rule in either direction", () => {
  const rules = new Map([
    ["OLD", { itemId: "OLD", successorItemId: "NEW", conversionFactor: 2 }],
  ]);
  assertEquals(pickFactor({ itemId: "OLD" }, "OLD", rules), 1);
  assertEquals(pickFactor({ itemId: "OLD" }, "NEW", rules), 2);
  assertEquals(pickFactor({ itemId: "NEW" }, "OLD", rules), 0.5);
  assertEquals(
    pickFactor(
      { itemId: "NEW", substitutedFromItemId: "X", substitutionFactor: 4 },
      "X",
      rules
    ),
    0.25
  );
  assertEquals(pickFactor({ itemId: "NEW" }, "Z", rules), 1);
});

Deno.test("linesideCredit: own live picks plus what no job's live pick claims", () => {
  const consumedByJob = new Map([["j-old", 3]]);
  const credit = linesideCredit({
    onHand: 4,
    claims: [
      { jobId: "j-old", jobMaterialId: "m-old", staged: 3 },
      { jobId: "j-me", jobMaterialId: "m-me", staged: 2 },
    ],
    consumedByJob,
    jobId: "j-me",
    jobMaterialId: "m-me",
  });
  assertEquals(credit, { own: 2, unclaimed: 2 });
});

Deno.test("linesideCredit: a cancelled pick leaves its material unclaimed, and the job's consumption reduces its own claim", () => {
  assertEquals(
    linesideCredit({
      onHand: 5,
      claims: [{ jobId: "j-me", jobMaterialId: "m-me", staged: 4 }],
      consumedByJob: new Map([["j-me", 1]]),
      jobId: "j-me",
      jobMaterialId: "m-me",
    }),
    { own: 3, unclaimed: 2 }
  );
  assertEquals(
    linesideCredit({ onHand: 2, claims: [], consumedByJob: new Map(), jobId: "j", jobMaterialId: "m" }),
    { own: 0, unclaimed: 2 }
  );
});

Deno.test("allocateAcrossBudgets takes a predecessor only in whole assemblies", () => {
  const budgets = [
    budget({ itemId: "old", storageUnitId: "ws", available: 3, isPredecessor: true }),
    budget({ itemId: "new", storageUnitId: "ws", available: 4 }),
  ];
  const { takes, remaining } = allocateAcrossBudgets(4, budgets, 2);
  assertEquals(takes.map((t) => [t.budget.itemId, t.quantity]), [["old", 2], ["new", 2]]);
  assertEquals(remaining, 0);
});

Deno.test("allocateAcrossBudgets attributes a take to the own pick first, then the shared stock", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({ itemId: "X", own: 4, unclaimed: 5 }),
  ]);
  assertEquals(
    takes.map((t) => [t.quantity, t.fromOwn, t.fromShared]),
    [[7, 4, 3]]
  );
});

Deno.test("recordSharedTakes ignores what came from a material's own pick", () => {
  const takenShared: SharedTakes = new Map();
  const { takes } = allocateAcrossBudgets(10, [
    budget({ itemId: "X", own: 10, unclaimed: 0, sharedStorageUnitId: "lineside" }),
  ]);
  recordSharedTakes(takenShared, takes);
  assertEquals(takenShared.size, 0);
});

Deno.test("recordSharedTakes accumulates the shared portion per item and bin", () => {
  const takenShared: SharedTakes = new Map();
  const first = allocateAcrossBudgets(6, [
    budget({ itemId: "X", own: 4, unclaimed: 5, sharedStorageUnitId: "lineside" }),
  ]);
  recordSharedTakes(takenShared, first.takes);
  const second = allocateAcrossBudgets(1, [
    budget({ itemId: "X", own: 0, unclaimed: 3, sharedStorageUnitId: "lineside" }),
    budget({ itemId: "X", own: 0, unclaimed: 3, sharedStorageUnitId: "other" }),
  ]);
  recordSharedTakes(takenShared, second.takes);
  assertEquals(takenShared.get(sharedTakeKey("X", "lineside")), 3);
  assertEquals(takenShared.get(sharedTakeKey("X", "other")), undefined);
});

Deno.test("a whole-assembly predecessor take still splits own-first", () => {
  const { takes } = allocateAcrossBudgets(
    4,
    [budget({ itemId: "OLD", own: 1, unclaimed: 2, isPredecessor: true })],
    2
  );
  assertEquals(
    takes.map((t) => [t.quantity, t.fromOwn, t.fromShared]),
    [[2, 1, 1]]
  );
});

Deno.test("splitTakeByBin writes one row when the pools share a bin", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({ itemId: "X", own: 4, unclaimed: 5, storageUnitId: "ws", sharedStorageUnitId: "ws" }),
  ]);
  assertEquals(splitTakeByBin(takes[0]), [{ storageUnitId: "ws", quantity: 7 }]);
});

Deno.test("splitTakeByBin charges each pool's own bin when they differ", () => {
  const { takes } = allocateAcrossBudgets(7, [
    budget({ itemId: "X", own: 4, unclaimed: 5, storageUnitId: "cart", sharedStorageUnitId: "ws" }),
  ]);
  assertEquals(splitTakeByBin(takes[0]), [
    { storageUnitId: "cart", quantity: 4 },
    { storageUnitId: "ws", quantity: 3 },
  ]);
  const shared = allocateAcrossBudgets(2, [
    budget({ itemId: "X", own: 0, unclaimed: 5, storageUnitId: "cart", sharedStorageUnitId: "ws" }),
  ]);
  assertEquals(splitTakeByBin(shared.takes[0]), [{ storageUnitId: "ws", quantity: 2 }]);
});
