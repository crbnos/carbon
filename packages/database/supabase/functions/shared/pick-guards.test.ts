import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  assertEntityCoversPick,
  PickGuardError,
  resolvePick
} from "./pick-guards.ts";

Deno.test("resolvePick: a partial pick accumulates onto the running total", () => {
  // Pick 4 then 6 on a 10-unit line → 4, then 10.
  const afterFirst = resolvePick({
    lineQuantity: 10,
    pickedQuantity: 0,
    transferQuantity: 4
  });
  assertEquals(afterFirst, 4);
  const afterSecond = resolvePick({
    lineQuantity: 10,
    pickedQuantity: afterFirst,
    transferQuantity: 6
  });
  assertEquals(afterSecond, 10);
});

Deno.test("resolvePick: an exact full pick is allowed", () => {
  assertEquals(
    resolvePick({ lineQuantity: 10, pickedQuantity: 0, transferQuantity: 10 }),
    10
  );
});

Deno.test("resolvePick: a float-residue full pick still lands exactly", () => {
  // 0.98 then 0.02 on a 1-unit line: the second pick equals the remainder at
  // scale, so it is allowed and totals exactly 1.
  const afterFirst = resolvePick({
    lineQuantity: 1,
    pickedQuantity: 0,
    transferQuantity: 0.98
  });
  assertEquals(
    resolvePick({
      lineQuantity: 1,
      pickedQuantity: afterFirst,
      transferQuantity: 1 - 0.98
    }),
    1
  );
});

Deno.test("resolvePick: an over-pick is refused", () => {
  const err = assertThrows(
    () =>
      resolvePick({
        lineQuantity: 10,
        pickedQuantity: 0,
        transferQuantity: 11
      }),
    PickGuardError
  );
  assertEquals((err as PickGuardError).kind, "over-pick");
});

Deno.test("resolvePick: a pick on a fully-picked line is refused", () => {
  const err = assertThrows(
    () =>
      resolvePick({
        lineQuantity: 10,
        pickedQuantity: 10,
        transferQuantity: 1
      }),
    PickGuardError
  );
  assertEquals((err as PickGuardError).kind, "already-picked");
});

Deno.test("resolvePick: even a tiny pick after full is refused", () => {
  assertThrows(
    () =>
      resolvePick({
        lineQuantity: 10,
        pickedQuantity: 10,
        transferQuantity: 0.02
      }),
    PickGuardError
  );
});

Deno.test("assertEntityCoversPick: drawing more than the lot holds is refused", () => {
  const err = assertThrows(
    () => assertEntityCoversPick({ entityQuantity: 5, transferQuantity: 6 }),
    PickGuardError
  );
  assertEquals((err as PickGuardError).kind, "over-pick");
});

Deno.test("assertEntityCoversPick: an exact (or equal-at-scale) full draw is allowed", () => {
  assertEntityCoversPick({ entityQuantity: 5, transferQuantity: 5 });
  assertEntityCoversPick({ entityQuantity: 1, transferQuantity: 0.98 + 0.02 });
});

Deno.test("resolvePick: refuses a pick that rounds to zero", () => {
  // Below half a minor unit at internal scale — accumulating it flips the line
  // to Picked and books a zero ledger pair for nothing.
  const err = assertThrows(
    () =>
      resolvePick({
        lineQuantity: 10,
        pickedQuantity: 0,
        transferQuantity: 0.000001
      }),
    PickGuardError,
    "rounds to zero"
  );
  assertEquals((err as PickGuardError).kind, "empty-pick");
  assertThrows(
    () => resolvePick({ lineQuantity: 10, pickedQuantity: 0, transferQuantity: 0 }),
    PickGuardError,
    "rounds to zero"
  );
});

Deno.test("resolvePick: an empty pick is refused before the already-picked check", () => {
  // A fully picked line scanned with a zero quantity reports the ZERO, not
  // "already fully picked" — the operator's input is what is wrong.
  const err = assertThrows(
    () =>
      resolvePick({ lineQuantity: 10, pickedQuantity: 10, transferQuantity: 0 }),
    PickGuardError
  );
  assertEquals((err as PickGuardError).kind, "empty-pick");
});

Deno.test("resolvePick: a smallest-storable pick is allowed", () => {
  assertEquals(
    resolvePick({ lineQuantity: 10, pickedQuantity: 0, transferQuantity: 0.00001 }),
    0.00001
  );
});
