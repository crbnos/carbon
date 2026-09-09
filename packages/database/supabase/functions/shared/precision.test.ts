import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { distributeRoundingResidual, round, SCALE } from "./precision.ts";

const sum = (values: number[]) => round(values.reduce((t, v) => t + v, 0), SCALE);

Deno.test("distributes a surplus one minor unit at a time, most under-rounded first", () => {
  // 20 lines of 1.99 at 8.25%: each exact tax is 0.164175, which rounds down to
  // 0.16 and leaves an 0.08 residual against the authoritative 3.28.
  const exact = Array.from({ length: 20 }, () => 1.99 * 0.0825);
  const allocated = distributeRoundingResidual(exact, 3.28, 2);
  assertEquals(sum(allocated), 3.28);
  // Every component stays within one minor unit of its own exact value, which
  // is the bound QuickBooks' `tax = net × percent` check assumes.
  for (const [index, value] of allocated.entries()) {
    assertEquals(Math.abs(value - exact[index]!) <= 0.01, true);
  }
  assertEquals(allocated.filter((v) => v === 0.17).length, 8);
  assertEquals(allocated.filter((v) => v === 0.16).length, 12);
});

Deno.test("takes a deficit from the most over-rounded parts", () => {
  // 0.128 rounds UP to 0.13, so those two parts owe a unit back; 0.121 rounds
  // DOWN and is asked last. One unit is owed, so only the first over-rounded
  // part gives it up.
  const allocated = distributeRoundingResidual([0.128, 0.128, 0.121], 0.37, 2);
  assertEquals(sum(allocated), 0.37);
  assertEquals(allocated, [0.12, 0.13, 0.12]);
});

Deno.test("breaks an exact deficit tie by index", () => {
  const allocated = distributeRoundingResidual([0.126, 0.126, 0.126], 0.37, 2);
  assertEquals(sum(allocated), 0.37);
  assertEquals(allocated, [0.12, 0.12, 0.13]);
});

Deno.test("returns the independently rounded values when nothing is left over", () => {
  assertEquals(distributeRoundingResidual([1.115, 2.22], 3.34, 2), [1.12, 2.22]);
});

Deno.test("resolves ties by index so the allocation is stable", () => {
  const first = distributeRoundingResidual([0.125, 0.125], 0.26, 2);
  const second = distributeRoundingResidual([0.125, 0.125], 0.26, 2);
  assertEquals(first, second);
  assertEquals(first, [0.13, 0.13]);
});

Deno.test("keeps signed parts on their own side of zero", () => {
  const allocated = distributeRoundingResidual([1.005, -0.335, -0.335], 0.34, 2);
  assertEquals(sum(allocated), 0.34);
  assertEquals(allocated[0]! > 0, true);
  assertEquals(
    allocated.slice(1).every((v) => v < 0),
    true
  );
});

Deno.test("refuses a residual larger than one unit per part — that is a real disagreement", () => {
  assertThrows(
    () => distributeRoundingResidual([1.0, 2.0], 10.0, 2),
    Error,
    "exceeds"
  );
});

Deno.test("refuses non-finite inputs", () => {
  assertThrows(
    () => distributeRoundingResidual([1, Number.NaN], 1, 2),
    Error,
    "finite"
  );
});

Deno.test("defaults to internal scale", () => {
  const allocated = distributeRoundingResidual([0.000005, 0.000005], 0.00002);
  assertEquals(sum(allocated), 0.00002);
});
