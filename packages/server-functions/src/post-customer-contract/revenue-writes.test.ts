// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type BilledTotals, changedRevenueLines } from "./revenue-writes";
import type { ContractLineRow } from "./schedule-writes";

const line = (overrides: Partial<ContractLineRow>): ContractLineRow =>
  ({
    id: "line-1",
    revenueType: "Recurring",
    startDate: "2026-01-01",
    endDate: null,
    goLiveDate: null,
    revenueStartDate: null,
    revenueEndDate: null,
    revenueMethod: "Daily",
    ...overrides
  }) as ContractLineRow;

const billed = (
  totals: [string, number][],
  ends: [string, string][] = []
): BilledTotals => ({
  totals: new Map(totals),
  lastPeriodEnds: new Map(ends)
});

describe("changedRevenueLines", () => {
  it("names nothing when neither the terms nor the billing moved", () => {
    const lines = [line({})];
    const state = { lines, billed: billed([["line-1", 300]]) };
    expect(changedRevenueLines(state, state)).toEqual([]);
  });

  it("names a new line, a line whose end moved and a line billed differently", () => {
    const before = {
      lines: [line({ id: "a" }), line({ id: "b" }), line({ id: "c" })],
      billed: billed(
        [
          ["a", 100],
          ["b", 100],
          ["c", 100]
        ],
        [["c", "2026-03-31"]]
      )
    };
    const after = {
      lines: [
        line({ id: "a" }),
        line({ id: "b", endDate: "2026-02-14" }),
        line({ id: "c" }),
        line({ id: "d" })
      ],
      billed: billed(
        [
          ["a", 100],
          ["b", 100],
          ["c", 100],
          ["d", 50]
        ],
        [["c", "2026-04-30"]]
      )
    };
    expect(changedRevenueLines(before, after)).toEqual(["b", "c", "d"]);
  });

  it("ignores float noise in a billed total", () => {
    const lines = [line({})];
    expect(
      changedRevenueLines(
        { lines, billed: billed([["line-1", 0.1 + 0.2]]) },
        { lines, billed: billed([["line-1", 0.3]]) }
      )
    ).toEqual([]);
  });
});
