// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  closeIncomeStatement,
  getTrialBalanceRows,
  getTrialBalanceTotals,
  hasYearEndClose,
  type TrialBalanceAccount,
  trialBalanceLedgerSummary
} from "./trial-balance";

const account = (
  overrides: Partial<TrialBalanceAccount> & Pick<TrialBalanceAccount, "id">
): TrialBalanceAccount => ({
  number: overrides.id,
  name: overrides.id,
  class: "Asset",
  incomeBalance: "Balance Sheet",
  isGroup: false,
  balanceAtDate: 0,
  netChange: 0,
  ...overrides
});

const revenue = (
  overrides: Partial<TrialBalanceAccount> & Pick<TrialBalanceAccount, "id">
) =>
  account({
    class: "Revenue",
    incomeBalance: "Income Statement",
    ...overrides
  });
const expense = (
  overrides: Partial<TrialBalanceAccount> & Pick<TrialBalanceAccount, "id">
) =>
  account({
    class: "Expense",
    incomeBalance: "Income Statement",
    ...overrides
  });

// Opening: cash 1000 against equity 1000. In the period: a 300 sale on
// account (AR / revenue) and 200 of expenses paid from cash.
const books: TrialBalanceAccount[] = [
  account({ id: "assets", isGroup: true, balanceAtDate: 1100 }),
  account({ id: "1010", name: "Cash", balanceAtDate: 800, netChange: -200 }),
  account({
    id: "1200",
    name: "Receivables",
    balanceAtDate: 300,
    netChange: 300
  }),
  account({ id: "3000", name: "Equity", class: "Equity", balanceAtDate: 1000 }),
  revenue({ id: "4000", name: "Sales", balanceAtDate: 300, netChange: 300 }),
  expense({ id: "6000", name: "Rent", balanceAtDate: 200, netChange: 200 })
];

describe("getTrialBalanceRows", () => {
  it("lists posting accounts only, in account-number order", () => {
    const rows = getTrialBalanceRows([...books].reverse(), "");
    expect(rows.map((r) => r.number)).toEqual([
      "1010",
      "1200",
      "3000",
      "4000",
      "6000"
    ]);
  });

  it("signs every balance debit-positive, credit-negative, whatever the class", () => {
    const rows = getTrialBalanceRows(books, "");
    const byNumber = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(byNumber["1010"]).toMatchObject({
      beginning: 1000,
      debits: 0,
      credits: 200,
      ending: 800
    });
    expect(byNumber["3000"]).toMatchObject({ beginning: -1000, ending: -1000 });
    expect(byNumber["4000"]).toMatchObject({
      beginning: 0,
      debits: 0,
      credits: 300,
      ending: -300
    });
    expect(byNumber["6000"]).toMatchObject({ debits: 200, ending: 200 });
  });

  it("totals to zero, with debits equal to credits", () => {
    const totals = getTrialBalanceTotals(getTrialBalanceRows(books, ""));
    expect(totals).toEqual({
      beginning: 0,
      debits: 500,
      credits: 500,
      close: 0,
      ending: 0,
      translatedEnding: null
    });
  });

  it("shows gross debits and credits when the account took both", () => {
    // Cash took in 500 and paid out 700 in the range: net −200.
    const [cash] = getTrialBalanceRows(
      [
        account({
          id: "1010",
          balanceAtDate: 800,
          netChange: -200,
          debits: 500,
          credits: 700
        })
      ],
      ""
    );
    expect(cash).toMatchObject({
      beginning: 1000,
      debits: 500,
      credits: 700,
      close: 0,
      ending: 800
    });
  });

  it("filters by number or name", () => {
    expect(getTrialBalanceRows(books, "rec").map((r) => r.number)).toEqual([
      "1200"
    ]);
    expect(getTrialBalanceRows(books, "40").map((r) => r.number)).toEqual([
      "4000"
    ]);
  });

  it("signs the translated ending like the ending", () => {
    const [row] = getTrialBalanceRows(
      [account({ id: "2000", class: "Liability", translatedBalance: 50 })],
      ""
    );
    expect(row!.translatedEnding).toBe(-50);
  });
});

describe("closeIncomeStatement", () => {
  // Last fiscal year: 1000 of sales and 600 of rent, so 400 of profit. This
  // year to date: 300 of sales, 200 of rent. Nothing was ever posted to
  // retained earnings (2900); cash holds everything.
  const lifetime: TrialBalanceAccount[] = [
    account({ id: "1010", balanceAtDate: 1500, netChange: 100 }),
    account({ id: "3000", class: "Equity", balanceAtDate: 1000 }),
    account({ id: "2900", class: "Equity" }),
    revenue({ id: "4000", balanceAtDate: 1300, netChange: 300 }),
    expense({ id: "6000", balanceAtDate: 800, netChange: 200 })
  ];
  const closedLastYear = { "4000": 1000, "6000": 600, "1010": 1400 };

  it("keeps this fiscal year on the income statement and moves earlier profit to retained earnings", () => {
    const rows = getTrialBalanceRows(
      closeIncomeStatement(lifetime, {
        retainedEarningsAccountId: "2900",
        closedAtStart: closedLastYear,
        closedAtEnd: closedLastYear
      }),
      ""
    );
    const byNumber = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(byNumber["4000"]).toMatchObject({ beginning: 0, ending: -300 });
    expect(byNumber["6000"]).toMatchObject({ beginning: 0, ending: 200 });
    expect(byNumber["2900"]).toMatchObject({ beginning: -400, ending: -400 });
    expect(byNumber["1010"]).toMatchObject({ beginning: 1400, ending: 1500 });
    expect(hasYearEndClose(rows)).toBe(false);
    expect(getTrialBalanceTotals(rows)).toMatchObject({
      beginning: 0,
      close: 0,
      ending: 0
    });
  });

  it("closes in a Year-End Close column when the range crosses a fiscal year end", () => {
    // The range starts late last year: 800 of last year's sales and 300 of
    // its rent are in it, with this year's 300 and 200.
    const gross: Record<
      string,
      Pick<TrialBalanceAccount, "netChange" | "debits" | "credits">
    > = {
      "1010": { netChange: 600, debits: 600, credits: 0 },
      "3000": { debits: 0, credits: 0 },
      "2900": { debits: 0, credits: 0 },
      "4000": { netChange: 1100, debits: 0, credits: 1100 },
      "6000": { netChange: 500, debits: 500, credits: 0 }
    };
    const crossing = lifetime.map((a) => ({ ...a, ...gross[a.id] }));
    const rows = getTrialBalanceRows(
      closeIncomeStatement(crossing, {
        retainedEarningsAccountId: "2900",
        // Nothing closed before last year; last year's 400 closes inside.
        closedAtStart: {},
        closedAtEnd: closedLastYear
      }),
      ""
    );
    const byNumber = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(byNumber["4000"]).toMatchObject({
      beginning: -200,
      close: 1000,
      ending: -300
    });
    expect(byNumber["6000"]).toMatchObject({
      beginning: 300,
      close: -600,
      ending: 200
    });
    expect(byNumber["2900"]).toMatchObject({
      beginning: 0,
      close: -400,
      ending: -400
    });
    expect(hasYearEndClose(rows)).toBe(true);
    expect(getTrialBalanceTotals(rows)).toMatchObject({
      beginning: 0,
      close: 0,
      ending: 0
    });
  });

  it("leaves balances as they are with no retained earnings account", () => {
    expect(
      closeIncomeStatement(lifetime, {
        retainedEarningsAccountId: null,
        closedAtStart: closedLastYear,
        closedAtEnd: closedLastYear
      })
    ).toBe(lifetime);
  });

  it.each([
    [
      "an Expense account",
      { class: "Expense", incomeBalance: "Income Statement" }
    ],
    [
      "an Equity account on the income statement",
      { class: "Equity", incomeBalance: "Income Statement" }
    ],
    [
      "a Balance Sheet account that is not Equity",
      { class: "Liability", incomeBalance: "Balance Sheet" }
    ]
  ])("closes nothing into %s", (_name, target) => {
    const accounts = lifetime.map((a) =>
      a.id === "2900" ? { ...a, ...target } : a
    );
    expect(
      closeIncomeStatement(accounts, {
        retainedEarningsAccountId: "2900",
        closedAtStart: closedLastYear,
        closedAtEnd: closedLastYear
      })
    ).toBe(accounts);
  });
});

describe("trialBalanceLedgerSummary", () => {
  it("reads as the row, with the close apart from the movement its lines add up to", () => {
    // Retained earnings: nothing posted, 400 of last year's profit closes in.
    const [row] = getTrialBalanceRows(
      [
        account({
          id: "2900",
          class: "Equity",
          balanceAtDate: 400,
          netChange: 400,
          debits: 0,
          credits: 0
        })
      ],
      ""
    );
    expect(trialBalanceLedgerSummary(row!)).toEqual({
      opening: 0,
      netChange: 0,
      close: -400,
      closing: -400
    });
  });

  it("moves an expense's opening, activity and close the way its row does", () => {
    // Opening 300 of last year's rent, 500 debited and 100 credited in the
    // range, then last year's 600 closes out: 300 + 400 − 600 = 100 ending.
    const [row] = getTrialBalanceRows(
      [
        expense({
          id: "6000",
          balanceAtDate: 100,
          netChange: -200,
          debits: 500,
          credits: 100
        })
      ],
      ""
    );
    expect(trialBalanceLedgerSummary(row!)).toEqual({
      opening: 300,
      netChange: 400,
      close: -600,
      closing: 100
    });
  });
});
