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

Deno.test("rounds to 4dp and stays balanced on fractional amounts", () => {
  const r = buildMemoJournal(base({ amountBase: 123.456789 }));
  assertEquals(line(r, "acct_ar").amount, -123.4568);
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
