// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  type BuildMemoJournalInput,
  buildMemoJournal
} from "./build-memo-journal.ts";

// Golden-master tests for the GL journal a credit/debit memo posts. A memo is a
// two-line entry: the AR/AP control leg and a reason leg. Direction alone decides
// the control side (Debit memo → DR control, Credit memo → CR control) for BOTH
// AR and AP. The reason leg is the inverse side, booked at the reason account's
// natural class. Every combo must balance (signedDebitTotal ~ 0).

const base = (
  overrides: Partial<BuildMemoJournalInput>
): BuildMemoJournalInput => ({
  memoId: "memo_1",
  companyId: "co_1",
  isAR: true,
  direction: "Credit",
  amount: 300,
  exchangeRate: 1,
  journalLineReference: "ref_1",
  controlAccountId: "acct_ar",
  reasonAccountId: "acct_reason",
  reasonAccountClass: "Revenue",
  ...overrides
});

// Helpers: stored `amount` is natural-balance signed. For an asset, a debit is
// +mag and a credit is −mag; for a liability/revenue it's the opposite.
const line = (r: ReturnType<typeof buildMemoJournal>, accountId: string) =>
  r.lines.find((l) => l.accountId === accountId)!;

it("customer Credit memo: CR AR (asset), DR reason; balances", () => {
  const r = buildMemoJournal(base({ isAR: true, direction: "Credit" }));
  expect(r.lines.length).toEqual(2);
  // Control AR is an asset; a credit stores −magnitude.
  expect(line(r, "acct_ar").amount).toEqual(-300);
  // Reason is Revenue; a debit stores −magnitude.
  expect(line(r, "acct_reason").amount).toEqual(-300);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("customer Debit memo: DR AR (asset), CR reason; balances", () => {
  const r = buildMemoJournal(base({ isAR: true, direction: "Debit" }));
  // Control AR debit stores +magnitude.
  expect(line(r, "acct_ar").amount).toEqual(300);
  // Reason Revenue credit stores +magnitude.
  expect(line(r, "acct_reason").amount).toEqual(300);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("supplier Credit memo: CR AP (liability), DR reason; balances", () => {
  const r = buildMemoJournal(
    base({ isAR: false, direction: "Credit", reasonAccountClass: "Expense" })
  );
  // Control AP is a liability; a credit stores +magnitude.
  expect(line(r, "acct_ar").amount).toEqual(300);
  // Reason Expense debit stores +magnitude.
  expect(line(r, "acct_reason").amount).toEqual(300);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("supplier Debit memo: DR AP (liability), CR reason; balances", () => {
  const r = buildMemoJournal(
    base({ isAR: false, direction: "Debit", reasonAccountClass: "Expense" })
  );
  // Control AP debit (liability) stores −magnitude.
  expect(line(r, "acct_ar").amount).toEqual(-300);
  // Reason Expense credit stores −magnitude.
  expect(line(r, "acct_reason").amount).toEqual(-300);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("rounds to internal scale and stays balanced on fractional amounts", () => {
  const r = buildMemoJournal(base({ amount: 123.456789 }));
  // SCALE = 5: GL lines carry internal precision, not the old 4dp column clamp.
  expect(line(r, "acct_ar").amount).toEqual(-123.45679);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("rejects a zero amount", () => {
  expect(() => buildMemoJournal(base({ amount: 0 }))).toThrow("greater than 0");
});

it("rejects an unknown reason account class", () => {
  expect(() => buildMemoJournal(base({ reasonAccountClass: "Bogus" }))).toThrow(
    "Unknown GL account class"
  );
});

// Scenario pin for the supplier-return cycle. The return SHIPMENT posts
// DR GRNI / CR Inventory, so the memo must CREDIT GRNI back to zero and DEBIT
// (reduce) AP — net DR AP / CR Inventory. That requires direction "Debit";
// `createPurchaseReturnOrderCredit` shipped as "Credit" once, which increased
// AP and left GRNI holding a permanent 2x debit. Both accounts are Liability,
// so a debit stores −magnitude and a credit +magnitude.
it("supplier RETURN debit memo: DR AP, CR GRNI (clears the shipment's GRNI debit)", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability"
    })
  );
  // AP debited → we owe the supplier less.
  expect(line(r, "acct_ap").amount).toEqual(-300);
  // GRNI credited → nets off the return shipment's DR GRNI.
  expect(line(r, "acct_grni").amount).toEqual(300);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

// The inverse, spelled out so the regression is unmistakable: a Credit
// direction on the same supplier-return inputs moves BOTH legs the wrong way.
it("supplier RETURN with Credit direction is backwards (increases AP, re-debits GRNI)", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Credit",
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability"
    })
  );
  expect(line(r, "acct_ap").amount).toEqual(300); // AP credited = owe MORE
  expect(line(r, "acct_grni").amount).toEqual(-300); // GRNI debited AGAIN
});

// --- Supplier return with a credit-vs-cost delta (spec: "credit-vs-cost delta
// → purchaseVarianceAccount"). The shipment debited GRNI at carried cost; the
// memo clears exactly that and books the difference as PPV, so GRNI nets to 0.

it("supplier RETURN: credited LESS than carried cost → DR variance (a loss)", () => {
  // RTS000001 shape: shipment relieved 120 of stock, supplier credits only 60.
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amount: 60,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 120,
      varianceAccountId: "acct_ppv"
    })
  );
  expect(r.lines.length).toEqual(3);
  expect(line(r, "acct_ap").amount).toEqual(-60); // DR AP by the credit
  expect(line(r, "acct_grni").amount).toEqual(120); // CR GRNI by carried cost
  expect(line(r, "acct_ppv").amount).toEqual(60); // DR expense = loss
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("supplier RETURN: credited MORE than carried cost → CR variance (a gain)", () => {
  // RTS000005 shape: shipment relieved 24 of stock, supplier credits 200.
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amount: 200,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 24,
      varianceAccountId: "acct_ppv"
    })
  );
  expect(r.lines.length).toEqual(3);
  expect(line(r, "acct_ap").amount).toEqual(-200);
  expect(line(r, "acct_grni").amount).toEqual(24);
  expect(line(r, "acct_ppv").amount).toEqual(-176); // CR expense = gain
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("supplier RETURN: credit equals carried cost → no variance leg at all", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amount: 290,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 290,
      varianceAccountId: "acct_ppv"
    })
  );
  expect(r.lines.length).toEqual(2);
  expect(Math.abs(r.signedDebitTotal) < 0.01).toBeTruthy();
});

it("refuses to post an unbalanced memo when no variance account is configured", () => {
  expect(() =>
    buildMemoJournal(
      base({
        isAR: false,
        direction: "Debit",
        amount: 60,
        reasonAccountClass: "Liability",
        reasonAmountBase: 120,
        varianceAccountId: null
      })
    )
  ).toThrow("no variance account");
});

it("memo55 at rate1.1 posts base50 rather than60.5", () => {
  const result = buildMemoJournal(base({ amount: 55, exchangeRate: 1.1 }));
  expect(line(result, "acct_ar").amount).toEqual(-50);
});
it("positive document principal remains postable below base dust thresholds", () => {
  const result = buildMemoJournal(base({ amount: 0.01, exchangeRate: 16000 }));
  expect(line(result, "acct_ar").amount).toBeCloseTo(0);
});
it("invalid memo snapshots are rejected before journal construction", () => {
  for (const exchangeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => buildMemoJournal(base({ exchangeRate }))).toThrow();
  }
  for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => buildMemoJournal(base({ amount }))).toThrow();
  }
});
