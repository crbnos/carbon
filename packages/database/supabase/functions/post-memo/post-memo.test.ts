import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { buildMemoJournal, type BuildMemoJournalInput } from "./build-memo-journal.ts";

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
  amountBase: 300,
  journalLineReference: "ref_1",
  controlAccountId: "acct_ar",
  reasonAccountId: "acct_reason",
  reasonAccountClass: "Revenue",
  ...overrides,
});

// Helpers: stored `amount` is natural-balance signed. For an asset, a debit is
// +mag and a credit is −mag; for a liability/revenue it's the opposite.
const line = (r: ReturnType<typeof buildMemoJournal>, accountId: string) =>
  r.lines.find((l) => l.accountId === accountId)!;

Deno.test("customer Credit memo: CR AR (asset), DR reason; balances", () => {
  const r = buildMemoJournal(base({ isAR: true, direction: "Credit" }));
  assertEquals(r.lines.length, 2);
  // Control AR is an asset; a credit stores −magnitude.
  assertEquals(line(r, "acct_ar").amount, -300);
  // Reason is Revenue; a debit stores −magnitude.
  assertEquals(line(r, "acct_reason").amount, -300);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("customer Debit memo: DR AR (asset), CR reason; balances", () => {
  const r = buildMemoJournal(base({ isAR: true, direction: "Debit" }));
  // Control AR debit stores +magnitude.
  assertEquals(line(r, "acct_ar").amount, 300);
  // Reason Revenue credit stores +magnitude.
  assertEquals(line(r, "acct_reason").amount, 300);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("supplier Credit memo: CR AP (liability), DR reason; balances", () => {
  const r = buildMemoJournal(
    base({ isAR: false, direction: "Credit", reasonAccountClass: "Expense" })
  );
  // Control AP is a liability; a credit stores +magnitude.
  assertEquals(line(r, "acct_ar").amount, 300);
  // Reason Expense debit stores +magnitude.
  assertEquals(line(r, "acct_reason").amount, 300);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("supplier Debit memo: DR AP (liability), CR reason; balances", () => {
  const r = buildMemoJournal(
    base({ isAR: false, direction: "Debit", reasonAccountClass: "Expense" })
  );
  // Control AP debit (liability) stores −magnitude.
  assertEquals(line(r, "acct_ar").amount, -300);
  // Reason Expense credit stores −magnitude.
  assertEquals(line(r, "acct_reason").amount, -300);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("rounds to internal scale and stays balanced on fractional amounts", () => {
  const r = buildMemoJournal(base({ amountBase: 123.456789 }));
  // SCALE = 5: GL lines carry internal precision, not the old 4dp column clamp.
  assertEquals(line(r, "acct_ar").amount, -123.45679);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("rejects a zero amount", () => {
  assertThrows(() => buildMemoJournal(base({ amountBase: 0 })), Error, "greater than 0");
});

Deno.test("rejects an unknown reason account class", () => {
  assertThrows(
    () => buildMemoJournal(base({ reasonAccountClass: "Bogus" })),
    Error,
    "Unknown GL account class"
  );
});

// Scenario pin for the supplier-return cycle. The return SHIPMENT posts
// DR GRNI / CR Inventory, so the memo must CREDIT GRNI back to zero and DEBIT
// (reduce) AP — net DR AP / CR Inventory. That requires direction "Debit";
// `createPurchaseReturnOrderCredit` shipped as "Credit" once, which increased
// AP and left GRNI holding a permanent 2x debit. Both accounts are Liability,
// so a debit stores −magnitude and a credit +magnitude.
Deno.test("supplier RETURN debit memo: DR AP, CR GRNI (clears the shipment's GRNI debit)", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
    })
  );
  // AP debited → we owe the supplier less.
  assertEquals(line(r, "acct_ap").amount, -300);
  // GRNI credited → nets off the return shipment's DR GRNI.
  assertEquals(line(r, "acct_grni").amount, 300);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

// The inverse, spelled out so the regression is unmistakable: a Credit
// direction on the same supplier-return inputs moves BOTH legs the wrong way.
Deno.test("supplier RETURN with Credit direction is backwards (increases AP, re-debits GRNI)", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Credit",
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
    })
  );
  assertEquals(line(r, "acct_ap").amount, 300); // AP credited = owe MORE
  assertEquals(line(r, "acct_grni").amount, -300); // GRNI debited AGAIN
});

// --- Supplier return with a credit-vs-cost delta (spec: "credit-vs-cost delta
// → purchaseVarianceAccount"). The shipment debited GRNI at carried cost; the
// memo clears exactly that and books the difference as PPV, so GRNI nets to 0.

Deno.test("supplier RETURN: credited LESS than carried cost → DR variance (a loss)", () => {
  // RTS000001 shape: shipment relieved 120 of stock, supplier credits only 60.
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amountBase: 60,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 120,
      varianceAccountId: "acct_ppv",
    })
  );
  assertEquals(r.lines.length, 3);
  assertEquals(line(r, "acct_ap").amount, -60); // DR AP by the credit
  assertEquals(line(r, "acct_grni").amount, 120); // CR GRNI by carried cost
  assertEquals(line(r, "acct_ppv").amount, 60); // DR expense = loss
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("supplier RETURN: credited MORE than carried cost → CR variance (a gain)", () => {
  // RTS000005 shape: shipment relieved 24 of stock, supplier credits 200.
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amountBase: 200,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 24,
      varianceAccountId: "acct_ppv",
    })
  );
  assertEquals(r.lines.length, 3);
  assertEquals(line(r, "acct_ap").amount, -200);
  assertEquals(line(r, "acct_grni").amount, 24);
  assertEquals(line(r, "acct_ppv").amount, -176); // CR expense = gain
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("supplier RETURN: credit equals carried cost → no variance leg at all", () => {
  const r = buildMemoJournal(
    base({
      isAR: false,
      direction: "Debit",
      amountBase: 290,
      controlAccountId: "acct_ap",
      reasonAccountId: "acct_grni",
      reasonAccountClass: "Liability",
      reasonAmountBase: 290,
      varianceAccountId: "acct_ppv",
    })
  );
  assertEquals(r.lines.length, 2);
  assert(Math.abs(r.signedDebitTotal) < 0.01);
});

Deno.test("refuses to post an unbalanced memo when no variance account is configured", () => {
  assertThrows(
    () =>
      buildMemoJournal(
        base({
          isAR: false,
          direction: "Debit",
          amountBase: 60,
          reasonAccountClass: "Liability",
          reasonAmountBase: 120,
          varianceAccountId: null,
        })
      ),
    Error,
    "no variance account"
  );
});
