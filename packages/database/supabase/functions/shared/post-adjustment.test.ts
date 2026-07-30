import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { computeCurrentUnitCost } from "./post-adjustment-cost.ts";

const layer = (
  quantity: number,
  remainingQuantity: number,
  cost: number,
  appliedChildCost = 0
) => ({ quantity, remainingQuantity, cost, appliedChildCost });

Deno.test("Standard items use standardCost", () => {
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "Standard", unitCost: 3, standardCost: 5 },
      [layer(100, 100, 1000)]
    ),
    5
  );
});

Deno.test("Average items use unitCost", () => {
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "Average", unitCost: 7.25, standardCost: 0 },
      []
    ),
    7.25
  );
});

Deno.test("FIFO uses the weighted average of open layers", () => {
  // 60 remaining @ $10 and 50 remaining @ $12 → (600 + 600) / 110
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 1, standardCost: 0 },
      [layer(100, 60, 1000), layer(50, 50, 600)]
    ),
    1200 / 110
  );
});

Deno.test("FIFO includes applied adjustment children in the layer cost", () => {
  // base layer qty 100 cost $1000 + $55 applied child → effective $10.55/unit
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 1, standardCost: 0 },
      [layer(100, 60, 1000, 55)]
    ),
    10.55
  );
});

Deno.test("FIFO falls back to unitCost when no layers are open", () => {
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "FIFO", unitCost: 4.5, standardCost: 0 },
      []
    ),
    4.5
  );
});

Deno.test("zero-quantity and fully-consumed layers are skipped", () => {
  assertEquals(
    computeCurrentUnitCost(
      { costingMethod: "LIFO", unitCost: 9, standardCost: 0 },
      [layer(0, 0, 500), layer(10, 0, 100), layer(10, 10, 100)]
    ),
    10
  );
});
