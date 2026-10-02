// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountClass } from "@carbon/utils";
import { expect, it } from "vitest";
import {
  type BuildReimbursementJournalInput,
  buildReimbursementJournal
} from "./build-reimbursement-journal";

// Golden-master tests for the GL journal an employee reimbursement posts. Each
// asserts the exact natural-balance-signed `amount` on each line (expense
// debits are +, liability credits are + — see `credit`/`debit` in @carbon/utils) AND that the entry
// balances (debits == credits), plus the refusal paths.

const ACCOUNTS: Record<string, { class: AccountClass }> = {
  payable: { class: "Liability" },
  ap: { class: "Liability" },
  bank: { class: "Asset" },
  exp1: { class: "Expense" },
  exp2: { class: "Expense" }
};

const line = <T extends { accountId: string }>(lines: T[], accountId: string) =>
  lines.find((l) => l.accountId === accountId);

// A journal balances in debit/credit space when the natural-signed amounts,
// re-projected to debit(+)/credit(−) by account class, sum to ~0.
const debitCreditBalance = (lines: { accountId: string; amount: number }[]) =>
  lines.reduce((sum, l) => {
    const cls = ACCOUNTS[l.accountId]!.class;
    // Asset/Expense: stored amount already equals its debit-signed value.
    // Liability/Equity/Revenue: stored amount is the negation of debit-signed.
    const debitSigned =
      cls === "Asset" || cls === "Expense" ? l.amount : -l.amount;
    return sum + debitSigned;
  }, 0);

const totals = (lines: { accountId: string; amount: number }[]) =>
  lines.reduce(
    (acc, l) => {
      const cls = ACCOUNTS[l.accountId]!.class;
      const debitSigned =
        cls === "Asset" || cls === "Expense" ? l.amount : -l.amount;
      return debitSigned >= 0
        ? { ...acc, totalDebits: acc.totalDebits + debitSigned }
        : { ...acc, totalCredits: acc.totalCredits - debitSigned };
    },
    { totalDebits: 0, totalCredits: 0 }
  );

const base = (
  over: Partial<BuildReimbursementJournalInput> = {}
): BuildReimbursementJournalInput => ({
  reimbursement: {
    amount: 620,
    payableAccountId: "payable",
    currencyCode: "USD",
    exchangeRate: 1,
    ...(over.reimbursement ?? {})
  },
  lines: over.lines ?? [
    { accountId: "exp1", amount: 500 },
    { accountId: "exp2", amount: 120 }
  ],
  accounts: over.accounts ?? ACCOUNTS,
  documentId: over.documentId ?? "reimb_1",
  documentReadableId: over.documentReadableId ?? "RB000001"
});

// ---------------------------------------------------------------------------
// AC1 — coding lines debited, employee payable credited for the total.
// ---------------------------------------------------------------------------

it("two coding lines: DR each expense / CR employee payable", () => {
  const { journalLines } = buildReimbursementJournal(base());

  expect(journalLines.length).toEqual(3);
  expect(line(journalLines, "exp1")!.amount).toEqual(500); // debit expense
  expect(line(journalLines, "exp2")!.amount).toEqual(120); // debit expense
  // A POSITIVE amount on a Liability account is a CREDIT.
  expect(line(journalLines, "payable")!.amount).toEqual(620);
  expect(line(journalLines, "payable")!.description).toEqual(
    "Employee reimbursement payable"
  );
  expect(line(journalLines, "exp1")!.documentType).toEqual("Reimbursement");
  expect(line(journalLines, "exp1")!.documentId).toEqual("reimb_1");
  expect(line(journalLines, "exp1")!.description).toEqual(
    "Employee reimbursement"
  );
  expect(debitCreditBalance(journalLines)).toEqual(0);
  expect(totals(journalLines)).toEqual({ totalDebits: 620, totalCredits: 620 });
});

it("a line description overrides the default", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      lines: [
        { accountId: "exp1", amount: 500, description: "Client dinner" },
        { accountId: "exp2", amount: 120 }
      ]
    })
  );
  expect(line(journalLines, "exp1")!.description).toEqual("Client dinner");
  expect(line(journalLines, "exp2")!.description).toEqual(
    "Employee reimbursement"
  );
});

// ---------------------------------------------------------------------------
// AC2 — the AP trade fallback must produce the identical, balanced journal.
// ---------------------------------------------------------------------------

it("AP trade fallback account produces the same balanced journal", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      reimbursement: {
        amount: 620,
        payableAccountId: "ap",
        currencyCode: "USD",
        exchangeRate: 1
      }
    })
  );

  expect(journalLines.length).toEqual(3);
  expect(line(journalLines, "ap")!.amount).toEqual(620);
  expect(line(journalLines, "exp1")!.amount).toEqual(500);
  expect(line(journalLines, "exp2")!.amount).toEqual(120);
  expect(debitCreditBalance(journalLines)).toEqual(0);
  expect(totals(journalLines)).toEqual({ totalDebits: 620, totalCredits: 620 });
});

// ---------------------------------------------------------------------------
// Dimensions ride the line they were coded on — and only that line.
// ---------------------------------------------------------------------------

it("costCenterId and projectId ride only their own line", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      lines: [
        {
          accountId: "exp1",
          amount: 500,
          costCenterId: "cc_1",
          projectId: "pj_1"
        },
        { accountId: "exp2", amount: 120 }
      ]
    })
  );

  expect(line(journalLines, "exp1")!.costCenterId).toEqual("cc_1");
  expect(line(journalLines, "exp1")!.projectId).toEqual("pj_1");
  expect(line(journalLines, "exp2")!.costCenterId).toEqual(null);
  expect(line(journalLines, "exp2")!.projectId).toEqual(null);
  // The payable leg is a control account — it never carries line coding.
  expect(line(journalLines, "payable")!.costCenterId).toEqual(null);
  expect(line(journalLines, "payable")!.projectId).toEqual(null);
});

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

it("a line sum that disagrees with the header refuses to post", () => {
  expect(() =>
    buildReimbursementJournal(
      base({
        lines: [
          { accountId: "exp1", amount: 500 },
          { accountId: "exp2", amount: 100 }
        ]
      })
    )
  ).toThrow("line sum 600 does not equal header amount 620");
});

it("no coding lines refuses to post", () => {
  expect(() => buildReimbursementJournal(base({ lines: [] }))).toThrow(
    "requires at least one line"
  );
});

it("a zero or negative line amount refuses to post", () => {
  for (const amount of [0, -120]) {
    expect(() =>
      buildReimbursementJournal(
        base({
          lines: [
            { accountId: "exp1", amount: 620 },
            { accountId: "exp2", amount }
          ]
        })
      )
    ).toThrow("must be finite and greater than zero");
  }
});

it("an unknown account id refuses to post", () => {
  expect(() =>
    buildReimbursementJournal(
      base({ lines: [{ accountId: "unknown", amount: 620 }] })
    )
  ).toThrow("missing account class for unknown");
  expect(() =>
    buildReimbursementJournal(
      base({
        reimbursement: {
          amount: 620,
          payableAccountId: "missing-payable",
          currencyCode: "USD",
          exchangeRate: 1
        }
      })
    )
  ).toThrow("missing account class for missing-payable");
});

// ---------------------------------------------------------------------------
// Foreign currency — every magnitude DIVIDED by the rate, still balanced.
// ---------------------------------------------------------------------------

it("exchangeRate 1.25 divides every magnitude and still balances", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      reimbursement: {
        amount: 620,
        payableAccountId: "payable",
        currencyCode: "EUR",
        exchangeRate: 1.25
      }
    })
  );

  expect(line(journalLines, "exp1")!.amount).toEqual(400); // 500 / 1.25
  expect(line(journalLines, "exp2")!.amount).toEqual(96); // 120 / 1.25
  expect(line(journalLines, "payable")!.amount).toEqual(496);
  expect(debitCreditBalance(journalLines)).toEqual(0);
  expect(totals(journalLines)).toEqual({ totalDebits: 496, totalCredits: 496 });
});

it("a corrupt exchange rate refuses to post", () => {
  for (const exchangeRate of [0, -1, Number.NaN]) {
    expect(() =>
      buildReimbursementJournal(
        base({
          reimbursement: {
            amount: 620,
            payableAccountId: "payable",
            currencyCode: "EUR",
            exchangeRate
          }
        })
      )
    ).toThrow();
  }
});
