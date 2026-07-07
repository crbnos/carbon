import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { proportionalShares } from "./proportional-shares.ts";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

Deno.test("splits proportionally when it divides evenly (spec example 5/20/10 of 70)", () => {
  assertEquals(proportionalShares(70, [5, 20, 10]), [10, 40, 20]);
});

Deno.test("largest-remainder: shares always sum exactly to the total", () => {
  const shares = proportionalShares(106, [20, 5]);
  assertEquals(sum(shares), 106);
  // 106*20/25 = 84.8 -> 84 (+1 for larger fraction) = 85; 106*5/25 = 21.2 -> 21
  assertEquals(shares, [85, 21]);
});

Deno.test("distributes the remainder to the largest fractional parts", () => {
  const shares = proportionalShares(10, [1, 1, 1]);
  assertEquals(sum(shares), 10);
  assertEquals(shares, [4, 3, 3]);
});

Deno.test("all-zero weights fall back to an even split", () => {
  assertEquals(proportionalShares(10, [0, 0]), [5, 5]);
});

Deno.test("single member gets the whole total", () => {
  assertEquals(proportionalShares(37, [9]), [37]);
});

Deno.test("zero total yields all zeros", () => {
  assertEquals(proportionalShares(0, [5, 20, 10]), [0, 0, 0]);
});
