// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  assertEntityCoversPick,
  PickGuardError,
  resolvePick
} from "./pick-guards";

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
};

it("resolvePick: a partial pick accumulates onto the running total", () => {
  // Pick 4 then 6 on a 10-unit line → 4, then 10.
  const afterFirst = resolvePick({
    lineQuantity: 10,
    pickedQuantity: 0,
    transferQuantity: 4
  });
  expect(afterFirst).toEqual(4);
  const afterSecond = resolvePick({
    lineQuantity: 10,
    pickedQuantity: afterFirst,
    transferQuantity: 6
  });
  expect(afterSecond).toEqual(10);
});

it("resolvePick: an exact full pick is allowed", () => {
  expect(
    resolvePick({ lineQuantity: 10, pickedQuantity: 0, transferQuantity: 10 })
  ).toEqual(10);
});

it("resolvePick: a float-residue full pick still lands exactly", () => {
  // 0.98 then 0.02 on a 1-unit line: the second pick equals the remainder at
  // scale, so it is allowed and totals exactly 1.
  const afterFirst = resolvePick({
    lineQuantity: 1,
    pickedQuantity: 0,
    transferQuantity: 0.98
  });
  expect(
    resolvePick({
      lineQuantity: 1,
      pickedQuantity: afterFirst,
      transferQuantity: 1 - 0.98
    })
  ).toEqual(1);
});

it("resolvePick: an over-pick is refused", () => {
  const err = thrown(() =>
    resolvePick({
      lineQuantity: 10,
      pickedQuantity: 0,
      transferQuantity: 11
    })
  );
  expect(err).toBeInstanceOf(PickGuardError);
  expect((err as PickGuardError).kind).toEqual("over-pick");
});

it("resolvePick: a pick on a fully-picked line is refused", () => {
  const err = thrown(() =>
    resolvePick({
      lineQuantity: 10,
      pickedQuantity: 10,
      transferQuantity: 1
    })
  );
  expect(err).toBeInstanceOf(PickGuardError);
  expect((err as PickGuardError).kind).toEqual("already-picked");
});

it("resolvePick: even a tiny pick after full is refused", () => {
  expect(() =>
    resolvePick({
      lineQuantity: 10,
      pickedQuantity: 10,
      transferQuantity: 0.02
    })
  ).toThrow(PickGuardError);
});

it("assertEntityCoversPick: drawing more than the lot holds is refused", () => {
  const err = thrown(() =>
    assertEntityCoversPick({ entityQuantity: 5, transferQuantity: 6 })
  );
  expect(err).toBeInstanceOf(PickGuardError);
  expect((err as PickGuardError).kind).toEqual("over-pick");
});

it("assertEntityCoversPick: an exact (or equal-at-scale) full draw is allowed", () => {
  assertEntityCoversPick({ entityQuantity: 5, transferQuantity: 5 });
  assertEntityCoversPick({ entityQuantity: 1, transferQuantity: 0.98 + 0.02 });
});

it("resolvePick: refuses a pick that rounds to zero", () => {
  // Below half a minor unit at internal scale — accumulating it flips the line
  // to Picked and books a zero ledger pair for nothing.
  const err = thrown(() =>
    resolvePick({
      lineQuantity: 10,
      pickedQuantity: 0,
      transferQuantity: 0.000001
    })
  );
  expect(err).toBeInstanceOf(PickGuardError);
  expect((err as Error).message).toContain("rounds to zero");
  expect((err as PickGuardError).kind).toEqual("empty-pick");
  expect(() =>
    resolvePick({ lineQuantity: 10, pickedQuantity: 0, transferQuantity: 0 })
  ).toThrow("rounds to zero");
});

it("resolvePick: an empty pick is refused before the already-picked check", () => {
  // A fully picked line scanned with a zero quantity reports the ZERO, not
  // "already fully picked" — the operator's input is what is wrong.
  const err = thrown(() =>
    resolvePick({ lineQuantity: 10, pickedQuantity: 10, transferQuantity: 0 })
  );
  expect(err).toBeInstanceOf(PickGuardError);
  expect((err as PickGuardError).kind).toEqual("empty-pick");
});

it("resolvePick: a smallest-storable pick is allowed", () => {
  expect(
    resolvePick({
      lineQuantity: 10,
      pickedQuantity: 0,
      transferQuantity: 0.00001
    })
  ).toEqual(0.00001);
});
