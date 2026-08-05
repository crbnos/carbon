import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { convertLength, isLengthUnit } from "./units.ts";
import { optimizeCuts1D } from "./ffd.ts";

Deno.test("same unit is the identity", () => {
  assertEquals(convertLength(150, "mm", "mm"), 150);
});

Deno.test("inch/metric conversions are exact", () => {
  assertEquals(convertLength(1, "in", "mm"), 25.4);
  assertEquals(convertLength(2, "m", "mm"), 2000);
  assertEquals(convertLength(1, "cm", "mm"), 10);
});

Deno.test("a foot is exactly twelve inches", () => {
  // A millimetre base makes this 12.000000000000002 and a 1 ft bar then reads
  // as marginally longer than 12 in — the reason units.ts counts in microns.
  assertEquals(convertLength(1, "ft", "in"), 12);
  assertEquals(convertLength(20, "ft", "in"), 240);
});

Deno.test("an unknown unit yields null, never a number", () => {
  // Returning 0 here would make a piece appear to fit inside nothing.
  assertEquals(convertLength(5, "furlong", "mm"), null);
  assertEquals(convertLength(5, "mm", null), null);
  assertEquals(convertLength(5, undefined, "mm"), null);
});

Deno.test("isLengthUnit guards the enum", () => {
  assertEquals(isLengthUnit("mm"), true);
  assertEquals(isLengthUnit("furlong"), false);
  assertEquals(isLengthUnit(42), false);
});

Deno.test("a 20 ft bar plans correctly inside an inch cut list", () => {
  const stockLength = convertLength(20, "ft", "in");
  assertEquals(stockLength, 240);

  const plan = optimizeCuts1D(
    [{ lineId: "l", length: 5.7, quantity: 41 }],
    [{ stockId: "bar", trackedEntityId: "B1", length: stockLength!, isRemnant: false }],
    { kerf: 0.06, endTrim: 0, gripMargin: 0, minRemnantLength: 1 }
  );

  assertEquals(plan.patterns.length, 1);
  assertEquals(plan.patterns[0].cuts.length, 41);
  assertEquals(plan.unplaced.length, 0);
});

Deno.test("without conversion the same bar reads as 20 units and fails", () => {
  // This is the bug the conversion exists to prevent: a stock length recorded
  // in feet, compared against inch-sized pieces, plans almost nothing.
  const plan = optimizeCuts1D(
    [{ lineId: "l", length: 5.7, quantity: 41 }],
    [{ stockId: "bar", trackedEntityId: "B1", length: 20, isRemnant: false }],
    { kerf: 0.06, endTrim: 0, gripMargin: 0, minRemnantLength: 1 }
  );
  assertEquals(plan.unplaced.length > 0, true);
});
