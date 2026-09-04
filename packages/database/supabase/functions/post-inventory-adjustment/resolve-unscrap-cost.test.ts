import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { resolveUnscrapUnitCost } from "./resolve-unscrap-cost.ts";

Deno.test("single negative scrap row resolves its unit cost", () => {
  assertEquals(resolveUnscrapUnitCost([{ quantity: -10, cost: -70 }]), 7);
});

Deno.test("multiple rows resolve the blended unit cost", () => {
  assertEquals(
    resolveUnscrapUnitCost([
      { quantity: -10, cost: -70 },
      { quantity: -5, cost: -50 },
    ]),
    8
  );
});

Deno.test("empty rows return null (caller falls back to current cost)", () => {
  assertEquals(resolveUnscrapUnitCost([]), null);
});

Deno.test("zero-quantity rows return null instead of dividing by zero", () => {
  assertEquals(resolveUnscrapUnitCost([{ quantity: 0, cost: 100 }]), null);
});
