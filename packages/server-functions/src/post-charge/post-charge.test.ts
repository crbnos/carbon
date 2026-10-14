// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountClass } from "@carbon/utils";
import { expect, it } from "vitest";
import {
  type BuildChargeJournalInput,
  buildChargeJournal
} from "./build-charge-journal";

// Golden-master tests for the GL journal a charge posts. Each asserts
// the exact natural-balance-signed `amount` on each line (asset/expense debits
// are +, credits −; liability/revenue/equity are the mirror — see `credit`/`debit` in @carbon/utils)
// AND that the entry balances (debits == credits). One case per transaction
// type, plus the imbalance-refusal path.

const ACCOUNTS: Record<string, { class: AccountClass }> = {
  card: { class: "Liability" },
  bank: { class: "Asset" },
  income: { class: "Revenue" },
  exp1: { class: "Expense" },
  exp2: { class: "Expense" }
};

const line = <T extends { accountId: string }>(lines: T[], accountId: string) =>
  lines.find((l) => l.accountId === accountId);

// A journal balances in debit/credit space when the natural-signed amounts,
// re-projected to debit(+)/credit(−) by account class, sum to ~0. Simpler here:
// re-derive from the known account classes.
const debitCreditBalance = (lines: { accountId: string; amount: number }[]) =>
  lines.reduce((sum, l) => {
    const cls = ACCOUNTS[l.accountId]!.class;
    // Asset/Expense: stored amount already equals its debit-signed value.
    // Liability/Equity/Revenue: stored amount is the negation of debit-signed.
    const debitSigned =
      cls === "Asset" || cls === "Expense" ? l.amount : -l.amount;
    return sum + debitSigned;
  }, 0);

const base = (
  over: Partial<BuildChargeJournalInput> = {}
): BuildChargeJournalInput => ({
  transaction: {
    type: "Charge",
    amount: 100,
    cardAccountId: "card",
    offsetAccountId: null,
    currencyCode: "USD",
    exchangeRate: 1,
    ...(over.transaction ?? {})
  },
  lines: over.lines ?? [],
  accounts: over.accounts ?? ACCOUNTS,
  documentId: over.documentId ?? "ct_1",
  documentReadableId: over.documentReadableId ?? "CT000001"
});

// ---------------------------------------------------------------------------
// Charge — expense lines debited, card liability credited.
// ---------------------------------------------------------------------------

it("Charge with two split lines: DR each expense / CR card liability", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1
      },
      lines: [
        { accountId: "exp1", amount: 60, costCenterId: "cc_1" },
        { accountId: "exp2", amount: 40 }
      ]
    })
  );

  expect(journalLines.length).toEqual(3);
  expect(line(journalLines, "exp1")!.amount).toEqual(60); // debit expense
  expect(line(journalLines, "exp1")!.costCenterId).toEqual("cc_1");
  expect(line(journalLines, "exp1")!.documentType).toEqual("Charge");
  expect(line(journalLines, "exp1")!.documentId).toEqual("ct_1");
  expect(line(journalLines, "exp2")!.amount).toEqual(40); // debit expense
  expect(line(journalLines, "exp2")!.costCenterId).toEqual(null);
  expect(line(journalLines, "card")!.amount).toEqual(100); // credit liability → +
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Credit — mirror image of a Charge.
// ---------------------------------------------------------------------------

it("Credit: CR expense line / DR card liability", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Credit",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1
      },
      lines: [{ accountId: "exp1", amount: 100 }]
    })
  );

  expect(journalLines.length).toEqual(2);
  expect(line(journalLines, "exp1")!.amount).toEqual(-100); // credit expense → −
  expect(line(journalLines, "card")!.amount).toEqual(-100); // debit liability → −
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Payment — pay down the card liability from the bank asset.
// ---------------------------------------------------------------------------

it("Payment: DR card liability / CR bank asset", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Payment",
        amount: 500,
        cardAccountId: "card",
        offsetAccountId: "bank",
        currencyCode: "USD",
        exchangeRate: 1
      }
    })
  );

  expect(journalLines.length).toEqual(2);
  expect(line(journalLines, "card")!.amount).toEqual(-500); // debit liability → −
  expect(line(journalLines, "bank")!.amount).toEqual(-500); // credit asset → −
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

it("Payment rejects stored coding lines that would be ignored", () => {
  expect(() =>
    buildChargeJournal(
      base({
        transaction: {
          type: "Payment",
          amount: 500,
          cardAccountId: "card",
          offsetAccountId: "bank",
          currencyCode: "USD",
          exchangeRate: 1
        },
        lines: [{ accountId: "exp1", amount: 500 }]
      })
    )
  ).toThrow("Payment cannot have coding lines");
});

// ---------------------------------------------------------------------------
// Cashback — reduce the card liability, book the offset as income.
// ---------------------------------------------------------------------------

it("Cashback: DR card liability / CR revenue", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Cashback",
        amount: 25,
        cardAccountId: "card",
        offsetAccountId: "income",
        currencyCode: "USD",
        exchangeRate: 1
      }
    })
  );

  expect(journalLines.length).toEqual(2);
  expect(line(journalLines, "card")!.amount).toEqual(-25); // debit liability → −
  expect(line(journalLines, "income")!.amount).toEqual(25); // credit revenue → +
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

it("Cashback rejects stored coding lines that would be ignored", () => {
  expect(() =>
    buildChargeJournal(
      base({
        transaction: {
          type: "Cashback",
          amount: 25,
          cardAccountId: "card",
          offsetAccountId: "income",
          currencyCode: "USD",
          exchangeRate: 1
        },
        lines: [{ accountId: "exp1", amount: 25 }]
      })
    )
  ).toThrow("Cashback cannot have coding lines");
});

// ---------------------------------------------------------------------------
// Repayment — offset debited for the total, each line credited.
// ---------------------------------------------------------------------------

it("Repayment: DR bank offset / CR card liability line", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Repayment",
        amount: 300,
        cardAccountId: "card",
        offsetAccountId: "bank",
        currencyCode: "USD",
        exchangeRate: 1
      },
      lines: [{ accountId: "card", amount: 300 }]
    })
  );

  expect(journalLines.length).toEqual(2);
  expect(line(journalLines, "bank")!.amount).toEqual(300); // debit asset → +
  expect(line(journalLines, "card")!.amount).toEqual(300); // credit liability → +
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Imbalance refusal — line sum must equal the header amount.
// ---------------------------------------------------------------------------

it("throws when the line sum does not equal the header amount", () => {
  expect(() =>
    buildChargeJournal(
      base({
        transaction: {
          type: "Charge",
          amount: 100,
          cardAccountId: "card",
          offsetAccountId: null,
          currencyCode: "USD",
          exchangeRate: 1
        },
        lines: [
          { accountId: "exp1", amount: 60 },
          { accountId: "exp2", amount: 30 } // 90 ≠ 100
        ]
      })
    )
  ).toThrow("does not equal header amount");
});

for (const invalidAmount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
  it(`rejects invalid coding line amount ${invalidAmount}`, () => {
    expect(() =>
      buildChargeJournal(
        base({
          transaction: {
            type: "Charge",
            amount: 100,
            cardAccountId: "card",
            offsetAccountId: null,
            currencyCode: "USD",
            exchangeRate: 1
          },
          lines: [
            { accountId: "exp1", amount: invalidAmount },
            { accountId: "exp2", amount: 100 - invalidAmount }
          ]
        })
      )
    ).toThrow("coding line amounts must be finite and greater than zero");
  });
}

// ---------------------------------------------------------------------------
// FX — exchangeRate ≠ 1 must convert BOTH sides to base currency, or the entry
// silently posts foreign face value / unbalances. `exchangeRate` is the
// canonical foreign-per-base rate (document units per 1 base unit), so a
// document amount converts to base by DIVIDING: base = document / rate. A
// regression that MULTIPLIED (the old inverted convention), or that converted
// only the coding lines or only the card side, fails here.
// ---------------------------------------------------------------------------

it("Charge at exchangeRate 2: both the lines AND the card credit convert to base (÷ rate)", () => {
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "EUR",
        exchangeRate: 2
      },
      lines: [
        { accountId: "exp1", amount: 60 },
        { accountId: "exp2", amount: 40 }
      ]
    })
  );

  expect(journalLines.length).toEqual(3);
  expect(line(journalLines, "exp1")!.amount).toEqual(30); // 60 ÷ 2 → base debit
  expect(line(journalLines, "exp2")!.amount).toEqual(20); // 40 ÷ 2 → base debit
  expect(line(journalLines, "card")!.amount).toEqual(50); // 100 ÷ 2 → base credit
  expect(Math.abs(debitCreditBalance(journalLines)) < 1e-9).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Split rounding — the card/offset side is the SUM of the rounded per-line
// magnitudes, NOT round(total): three lines that each round down leave the card
// side at 0.99999, and the entry still balances exactly. A regression computing
// the card side from round(header) would post 1.0 here and this pins it.
// ---------------------------------------------------------------------------

it("Charge with three rounding lines: card side = Σ rounded lines, balances exactly", () => {
  const accounts: Record<string, { class: AccountClass }> = {
    card: { class: "Liability" },
    exp1: { class: "Expense" },
    exp2: { class: "Expense" },
    exp3: { class: "Expense" }
  };
  const { journalLines } = buildChargeJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 1,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1
      },
      lines: [
        { accountId: "exp1", amount: 0.333333 },
        { accountId: "exp2", amount: 0.333333 },
        { accountId: "exp3", amount: 0.333334 }
      ],
      accounts
    })
  );

  // Each line rounds to 0.33333 at internal scale; the card credit is their sum
  // (0.99999), NOT round(header) = 1.0 — so the split balances exactly.
  expect(line(journalLines, "exp1")!.amount).toEqual(0.33333);
  expect(line(journalLines, "exp2")!.amount).toEqual(0.33333);
  expect(line(journalLines, "exp3")!.amount).toEqual(0.33333);
  expect(line(journalLines, "card")!.amount).toEqual(0.99999);
  // Re-derive balance against this test's own account map.
  const balance = journalLines.reduce((sum, l) => {
    const cls = accounts[l.accountId]!.class;
    return sum + (cls === "Expense" ? l.amount : -l.amount);
  }, 0);
  expect(Math.abs(balance) < 1e-9).toBeTruthy();
});
