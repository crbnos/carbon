import { assertEquals, assertThrows } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildCutListPostingPlan,
  buildRemnantAttributes
} from "./cut-list-confirm.ts";

const line = (
  id: string,
  jobId: string | null,
  pieceLength: number,
  quantity: number,
  quantityCut = 0
) => ({ id, jobId, itemId: "item-bar", pieceLength, quantity, quantityCut });

Deno.test("splits consumption across jobs by nested length", () => {
  // Job A takes 2 x 10 = 20; Job B takes 1 x 10 = 10. A pays 2/3, B pays 1/3.
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 2), line("l2", "jobB", 10, 1)],
    inputs: [
      { cutListLineId: "l1", quantityCut: 2 },
      { cutListLineId: "l2", quantityCut: 1 }
    ],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 3 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });

  assertEquals(plan.allocations.length, 2);
  assertEquals(plan.allocations[0].jobId, "jobA");
  assertEquals(plan.allocations[0].quantity, 2);
  assertEquals(plan.allocations[1].jobId, "jobB");
  assertEquals(plan.allocations[1].quantity, 1);
});

Deno.test("allocations always sum to exactly the consumed quantity", () => {
  // Thirds don't divide evenly — the last share absorbs the rounding so no
  // fractional cost is stranded on the run.
  const plan = buildCutListPostingPlan({
    lines: [
      line("l1", "jobA", 1, 1),
      line("l2", "jobB", 1, 1),
      line("l3", "jobC", 1, 1)
    ],
    inputs: [
      { cutListLineId: "l1", quantityCut: 1 },
      { cutListLineId: "l2", quantityCut: 1 },
      { cutListLineId: "l3", quantityCut: 1 }
    ],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });

  const total = plan.allocations.reduce((sum, a) => sum + a.quantity, 0);
  assertEquals(total, 1);
});

Deno.test("a drop at or above the minimum returns to stock", () => {
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 1)],
    inputs: [{ cutListLineId: "l1", quantityCut: 1 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [{ fromTrackedEntityId: "lot1", length: 12 }],
    scrap: [],
    minRemnantLength: 12
  });

  assertEquals(plan.remnants.length, 1);
  assertEquals(plan.remnants[0].length, 12);
  assertEquals(plan.scrap.length, 0);
});

Deno.test("a drop below the minimum becomes scrap, not inventory", () => {
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 1)],
    inputs: [{ cutListLineId: "l1", quantityCut: 1 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [{ fromTrackedEntityId: "lot1", length: 2 }],
    scrap: [],
    minRemnantLength: 12
  });

  assertEquals(plan.remnants.length, 0);
  assertEquals(plan.scrap.length, 1);
  assertEquals(plan.scrap[0].quantity, 2);
  assertEquals(plan.scrap[0].fromTrackedEntityId, "lot1");
});

Deno.test("completes only when every line is fully cut", () => {
  const partial = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 5)],
    inputs: [{ cutListLineId: "l1", quantityCut: 3 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });
  assertEquals(partial.status, "In Progress");
  assertEquals(partial.lineUpdates[0].quantityCut, 3);

  const rest = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 5, 3)],
    inputs: [{ cutListLineId: "l1", quantityCut: 2 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });
  assertEquals(rest.status, "Completed");
  assertEquals(rest.lineUpdates[0].quantityCut, 5);
});

Deno.test("over-cutting is clamped to what the line still owes", () => {
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 10, 5, 4)],
    inputs: [{ cutListLineId: "l1", quantityCut: 99 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });
  assertEquals(plan.lineUpdates[0].quantityCut, 5);
});

Deno.test("yield ignores a returned drop — it is still stock", () => {
  // 240 bar, 200 cut into parts, 40 drop returned. 200/200 = 100%, not 83%.
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 100, 2)],
    inputs: [{ cutListLineId: "l1", quantityCut: 2 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [{ fromTrackedEntityId: "lot1", length: 40 }],
    scrap: [],
    minRemnantLength: 12,
    stockLengthByEntity: { lot1: 240 }
  });

  assertEquals(plan.actualYieldPct, 100);
});

Deno.test("yield counts a scrapped drop against the run", () => {
  // Same bar, but the 40 is below the minimum so it is consumed as waste.
  const plan = buildCutListPostingPlan({
    lines: [line("l1", "jobA", 100, 2)],
    inputs: [{ cutListLineId: "l1", quantityCut: 2 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [{ fromTrackedEntityId: "lot1", length: 40 }],
    scrap: [],
    minRemnantLength: 60,
    stockLengthByEntity: { lot1: 240 }
  });

  assertEquals(plan.remnants.length, 0);
  assertEquals(plan.actualYieldPct, 83.33);
});

Deno.test("lines cut to stock carry a null job", () => {
  const plan = buildCutListPostingPlan({
    lines: [line("l1", null, 10, 1)],
    inputs: [{ cutListLineId: "l1", quantityCut: 1 }],
    consumed: [{ trackedEntityId: "lot1", quantityConsumed: 1 }],
    remnants: [],
    scrap: [],
    minRemnantLength: 0
  });

  assertEquals(plan.allocations.length, 1);
  assertEquals(plan.allocations[0].jobId, null);
});

Deno.test("an unknown line id is rejected rather than ignored", () => {
  assertThrows(
    () =>
      buildCutListPostingPlan({
        lines: [line("l1", "jobA", 10, 1)],
        inputs: [{ cutListLineId: "nope", quantityCut: 1 }],
        consumed: [],
        remnants: [],
        scrap: [],
        minRemnantLength: 0
      }),
    Error,
    "Unknown cut list line"
  );
});

Deno.test("a negative quantity is rejected", () => {
  assertThrows(
    () =>
      buildCutListPostingPlan({
        lines: [line("l1", "jobA", 10, 1)],
        inputs: [{ cutListLineId: "l1", quantityCut: -1 }],
        consumed: [],
        remnants: [],
        scrap: [],
        minRemnantLength: 0
      }),
    Error,
    "cannot be negative"
  );
});

Deno.test("a remnant inherits its parent's heat number", () => {
  const attributes = buildRemnantAttributes({
    length: 72,
    unitOfDimension: "in",
    parentAttributes: { "Heat Number": "H12345", Supplier: "Ryerson" },
    cutListReadableId: "CL000001"
  });

  assertEquals(attributes.Remnant, true);
  assertEquals(attributes.Length, 72);
  assertEquals(attributes.Unit, "in");
  assertEquals(attributes["Heat Number"], "H12345");
  assertEquals(attributes["Cut List"], "CL000001");
});

Deno.test("a remnant with no parent heat number omits the key", () => {
  const attributes = buildRemnantAttributes({
    length: 72,
    unitOfDimension: "in",
    parentAttributes: null,
    cutListReadableId: "CL000001"
  });

  assertEquals("Heat Number" in attributes, false);
  assertEquals(attributes.Remnant, true);
});
