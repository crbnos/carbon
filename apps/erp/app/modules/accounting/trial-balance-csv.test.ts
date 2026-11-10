// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  mapTrialBalanceAccounts,
  parseTrialBalanceAmount,
  parseTrialBalanceCsv
} from "./trial-balance-csv";

const csv = (...lines: string[]) =>
  ["accountNumber,debit,credit", ...lines].join("\n");

describe("parseTrialBalanceAmount", () => {
  it("reads empty as zero and plain decimals as written", () => {
    expect(parseTrialBalanceAmount("")).toEqual({ amount: 0 });
    expect(parseTrialBalanceAmount(undefined)).toEqual({ amount: 0 });
    expect(parseTrialBalanceAmount(" 1234.56 ")).toEqual({ amount: 1234.56 });
    expect(parseTrialBalanceAmount("0")).toEqual({ amount: 0 });
    expect(parseTrialBalanceAmount(".5")).toEqual({ amount: 0.5 });
  });

  it("refuses any comma instead of guessing what it separates", () => {
    for (const value of ["1.234,56", "1234,56", "1,234.56", "1,234"]) {
      expect(parseTrialBalanceAmount(value)).toEqual({
        error: "ambiguous-amount"
      });
    }
  });

  it("refuses negatives, signs, symbols and words", () => {
    for (const value of ["-5", "+5", "$5", "1e3", "abc", "1 234", "1.2.3"]) {
      expect(parseTrialBalanceAmount(value)).toEqual({
        error: "invalid-amount"
      });
    }
  });
});

describe("parseTrialBalanceCsv", () => {
  it("reads every row", () => {
    expect(parseTrialBalanceCsv(csv("1000,500.25,", "2000,,500.25"))).toEqual({
      rows: [
        { line: 2, accountNumber: "1000", debit: 500.25, credit: 0 },
        { line: 3, accountNumber: "2000", debit: 0, credit: 500.25 }
      ],
      errors: null
    });
  });

  it("names the missing columns", () => {
    expect(parseTrialBalanceCsv("account,debit\n1000,5")).toEqual({
      rows: null,
      errors: [
        { code: "missing-columns", columns: ["accountNumber", "credit"] }
      ]
    });
  });

  it("refuses a European amount rather than reading 1.234,56 as 1.23456", () => {
    const result = parseTrialBalanceCsv(csv('1000,"1.234,56",'));
    expect(result).toEqual({
      rows: null,
      errors: [
        {
          code: "ambiguous-amount",
          line: 2,
          accountNumber: "1000",
          column: "debit",
          value: "1.234,56"
        }
      ]
    });
  });

  it("refuses an account on two rows instead of summing them", () => {
    expect(parseTrialBalanceCsv(csv("1000,5,", "2000,,5", "1000,1,"))).toEqual({
      rows: null,
      errors: [
        {
          code: "duplicate-account",
          line: 4,
          firstLine: 2,
          accountNumber: "1000"
        }
      ]
    });
  });

  it("keeps both a debit and a credit on one row, for the journal to net", () => {
    expect(parseTrialBalanceCsv(csv("1000,300,100"))).toEqual({
      rows: [{ line: 2, accountNumber: "1000", debit: 300, credit: 100 }],
      errors: null
    });
  });

  it("collects every error in file order", () => {
    expect(parseTrialBalanceCsv(csv(",5,", "1000,abc,-1"))).toEqual({
      rows: null,
      errors: [
        { code: "missing-account-number", line: 2 },
        {
          code: "invalid-amount",
          line: 3,
          accountNumber: "1000",
          column: "debit",
          value: "abc"
        },
        {
          code: "invalid-amount",
          line: 3,
          accountNumber: "1000",
          column: "credit",
          value: "-1"
        }
      ]
    });
  });
});

describe("mapTrialBalanceAccounts", () => {
  const accounts = new Map([
    ["1000", "acct_cash"],
    ["2000", "acct_ap"]
  ]);

  it("maps each row to its account and drops empty rows", () => {
    expect(
      mapTrialBalanceAccounts(
        [
          { line: 2, accountNumber: "1000", debit: 5, credit: 0 },
          { line: 3, accountNumber: "2000", debit: 0, credit: 0 }
        ],
        accounts
      )
    ).toEqual({
      lines: [{ accountId: "acct_cash", debit: 5, credit: 0 }],
      errors: null
    });
  });

  it("names every account number with no active posting account", () => {
    expect(
      mapTrialBalanceAccounts(
        [
          { line: 2, accountNumber: "1000", debit: 5, credit: 0 },
          { line: 3, accountNumber: "9999", debit: 0, credit: 5 },
          { line: 4, accountNumber: "8888", debit: 0, credit: 0 }
        ],
        accounts
      )
    ).toEqual({
      lines: null,
      errors: [
        { code: "unknown-account", accountNumber: "9999" },
        { code: "unknown-account", accountNumber: "8888" }
      ]
    });
  });
});
