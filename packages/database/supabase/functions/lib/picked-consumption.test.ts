import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  allocateAcrossBudgets,
  orderOldFirst,
  type PickedBudget,
  pickFactor,
  linesideCredit,
} from "./picked-consumption.ts";

const budget = (overrides: Partial<PickedBudget>): PickedBudget => ({
  itemId: "OLD",
  factor: 1,
  storageUnitId: "shelf",
  available: 0,
  isInventory: true,
  isPredecessor: false,
  ...overrides,
});

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
    { itemId: "old", factor: 1, storageUnitId: "ws", available: 3, isInventory: true, isPredecessor: true },
    { itemId: "new", factor: 1, storageUnitId: "ws", available: 4, isInventory: true, isPredecessor: false },
  ];
  const { takes, remaining } = allocateAcrossBudgets(4, budgets, 2);
  assertEquals(takes.map((t) => [t.budget.itemId, t.quantity]), [["old", 2], ["new", 2]]);
  assertEquals(remaining, 0);
});
