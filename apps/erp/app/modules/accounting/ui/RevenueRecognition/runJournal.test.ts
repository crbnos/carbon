// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { summarizeRunJournal } from "./runJournal";

const row = (
  debitAccountId: string,
  creditAccountId: string,
  amount: number
) => ({
  schedule: { debitAccountId, creditAccountId, amount }
});

describe("summarizeRunJournal", () => {
  it("swaps the sides of a negative row, as posting does", () => {
    const rows = summarizeRunJournal([
      row("deferred", "revenue", 300),
      row("deferred", "revenue", -100)
    ]);

    expect(rows).toEqual([
      { accountId: "deferred", debit: 200, credit: 0 },
      { accountId: "revenue", debit: 0, credit: 200 }
    ]);
  });

  it("balances, with debits first and each side ordered by account", () => {
    const rows = summarizeRunJournal([
      row("wip-cogs", "project-wip", 40.12345),
      row("contract-assets", "revenue", 100.1),
      row("contract-assets", "revenue", -25.05),
      row("revenue", "deferred", 10)
    ]);

    expect(rows.map((r) => r.accountId)).toEqual([
      "contract-assets",
      "wip-cogs",
      "deferred",
      "project-wip",
      "revenue"
    ]);
    const debit = rows.reduce((sum, r) => sum + r.debit, 0);
    const credit = rows.reduce((sum, r) => sum + r.credit, 0);
    expect(debit).toBeCloseTo(credit, 5);
    expect(rows.find((r) => r.accountId === "revenue")).toEqual({
      accountId: "revenue",
      debit: 0,
      credit: 65.05
    });
  });

  it("leaves out rows with no schedule, zero amounts and accounts that net to zero", () => {
    expect(
      summarizeRunJournal([
        { schedule: null },
        row("a", "b", 0),
        row("a", "b", 50),
        row("b", "a", 50)
      ])
    ).toEqual([]);
  });

  it("reads numeric strings", () => {
    expect(
      summarizeRunJournal([
        {
          schedule: {
            debitAccountId: "a",
            creditAccountId: "b",
            amount: "12.5"
          }
        }
      ])
    ).toEqual([
      { accountId: "a", debit: 12.5, credit: 0 },
      { accountId: "b", debit: 0, credit: 12.5 }
    ]);
  });
});
