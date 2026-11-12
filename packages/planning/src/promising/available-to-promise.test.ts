// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type DatedQuantity,
  earliestWeekWithStock,
  freeStockByWeek,
  weekStarts
} from "./available-to-promise.ts";

// 2026-11-10 is a Tuesday; its week starts on Sunday 2026-11-08.
const TODAY = "2026-11-10";
const WEEKS = weekStarts(TODAY, "2026-12-01"); // 4 weeks: Nov 8, 15, 22, 29

function free(args: {
  onHand: number;
  supply?: DatedQuantity[];
  demand?: DatedQuantity[];
}) {
  return freeStockByWeek({
    onHand: args.onHand,
    supply: args.supply ?? [],
    demand: args.demand ?? [],
    weeks: WEEKS,
    todayIso: TODAY
  });
}

describe("weekStarts", () => {
  it("lists every Sunday from today's week to the last date's week", () => {
    expect(WEEKS).toEqual([
      "2026-11-08",
      "2026-11-15",
      "2026-11-22",
      "2026-11-29"
    ]);
  });
});

describe("freeStockByWeek", () => {
  it("keeps stock a later order holds out of this week's free stock", () => {
    // 100 on hand, another order takes 80 next week: only 20 are free now.
    const result = free({
      onHand: 100,
      demand: [{ date: "2026-11-17", quantity: 80 }]
    });
    expect(result).toEqual([20, 20, 20, 20]);
    expect(earliestWeekWithStock(result, 30)).toBeNull();
    expect(earliestWeekWithStock(result, 20)).toBe(0);
  });

  it("frees stock from the week a purchase order arrives", () => {
    // 20 on hand, a PO for 50 arrives in the week of Nov 22.
    const result = free({
      onHand: 20,
      supply: [{ date: "2026-11-24", quantity: 50 }]
    });
    expect(result).toEqual([20, 20, 70, 70]);
    expect(earliestWeekWithStock(result, 60)).toBe(2);
  });

  it("counts past-due demand in the current week", () => {
    const result = free({
      onHand: 10,
      demand: [{ date: "2026-10-01", quantity: 4 }]
    });
    expect(result).toEqual([6, 6, 6, 6]);
  });

  it("never reports negative free stock", () => {
    const result = free({
      onHand: 5,
      demand: [{ date: "2026-11-12", quantity: 9 }],
      supply: [{ date: "2026-11-30", quantity: 20 }]
    });
    expect(result).toEqual([0, 0, 0, 16]);
  });

  it("ignores rows after the last week", () => {
    const result = free({
      onHand: 10,
      demand: [{ date: "2027-02-01", quantity: 10 }]
    });
    expect(result).toEqual([10, 10, 10, 10]);
  });
});
