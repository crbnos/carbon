// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { movingAverageUnitCost } from "~/modules/shared/shared.service";

describe("movingAverageUnitCost", () => {
  it("blends a receipt into the stock on hand", () => {
    // 10 on hand at 10, 10 received for 200.
    expect(
      movingAverageUnitCost({
        onHand: 10,
        unitCost: 10,
        quantity: 10,
        value: 200
      })
    ).toBe(15);
  });

  it("takes the receipt's own cost when nothing is on hand", () => {
    expect(
      movingAverageUnitCost({ onHand: 0, unitCost: 10, quantity: 10, value: 200 })
    ).toBe(20);
  });

  it("ignores how long ago the stock on hand was bought", () => {
    // 100 bought at 10 over a year ago, 5 shipped since, 10 received at 20.
    // A trailing-year average of the cost ledger read 30 here.
    const cost = movingAverageUnitCost({
      onHand: 95,
      unitCost: 10,
      quantity: 10,
      value: 200
    });
    expect(cost).toBeCloseTo((95 * 10 + 200) / 105, 10);
  });

  it("spreads a price variance over the units on hand", () => {
    // 4 on hand at 10 take an 8 write-up: 12 a unit.
    expect(
      movingAverageUnitCost({ onHand: 4, unitCost: 10, quantity: 0, value: 8 })
    ).toBe(12);
  });

  it("takes units out at their own cost", () => {
    // A voided receipt of 10 for 200 out of 20 on hand at 15.
    expect(
      movingAverageUnitCost({
        onHand: 20,
        unitCost: 15,
        quantity: -10,
        value: -200
      })
    ).toBe(10);
  });

  it("takes the receipt's own cost into negative stock", () => {
    // 5 shipped before any were received, then 10 received for 200. Blending
    // the -5 at 10 read 30; for 20, (−50 + 20) / 5 read a negative cost.
    expect(
      movingAverageUnitCost({ onHand: -5, unitCost: 10, quantity: 10, value: 200 })
    ).toBe(20);
    expect(
      movingAverageUnitCost({ onHand: -5, unitCost: 10, quantity: 10, value: 20 })
    ).toBe(2);
  });

  it("keeps the cost when a receipt does not cover negative stock", () => {
    expect(
      movingAverageUnitCost({ onHand: -5, unitCost: 10, quantity: -2, value: -20 })
    ).toBe(10);
  });

  it("keeps the cost when nothing is left on hand", () => {
    expect(
      movingAverageUnitCost({
        onHand: 10,
        unitCost: 15,
        quantity: -10,
        value: -200
      })
    ).toBe(15);
    expect(
      movingAverageUnitCost({ onHand: 0, unitCost: 15, quantity: 0, value: 8 })
    ).toBe(15);
  });
});
