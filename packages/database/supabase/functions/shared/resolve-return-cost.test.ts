import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { resolveReturnUnitCost } from "./resolve-return-cost.ts";

Deno.test("single consumption row yields its unit cost", () => {
  // shipment consumed 5 units at total cost 50 (negative rows in the ledger)
  assertEquals(resolveReturnUnitCost([{ quantity: -5, cost: -50 }]), 10);
});

Deno.test("multiple rows yield the weighted average", () => {
  // two layers consumed: 3 @ 10 and 1 @ 30 → (30 + 30) / 4 = 15
  assertEquals(
    resolveReturnUnitCost([
      { quantity: -3, cost: -30 },
      { quantity: -1, cost: -30 },
    ]),
    15
  );
});

Deno.test("sign of the stored rows does not matter", () => {
  assertEquals(
    resolveReturnUnitCost([
      { quantity: 2, cost: 25 },
      { quantity: -2, cost: -25 },
    ]),
    12.5
  );
});

Deno.test("empty rows yield null (caller falls back to current cost)", () => {
  assertStrictEquals(resolveReturnUnitCost([]), null);
});

Deno.test("zero-quantity rows yield null instead of dividing by zero", () => {
  assertStrictEquals(
    resolveReturnUnitCost([{ quantity: 0, cost: 100 }]),
    null
  );
});

Deno.test("non-numeric garbage is treated as zero", () => {
  assertStrictEquals(
    resolveReturnUnitCost([
      { quantity: Number.NaN, cost: Number.NaN },
    ]),
    null
  );
});
