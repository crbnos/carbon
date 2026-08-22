import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildCardTransactionJournal,
  type BuildCardTransactionJournalInput,
  type GLAccountClass,
} from "./build-card-transaction-journal.ts";

// Golden-master tests for the GL journal a card transaction posts. Each asserts
// the exact natural-balance-signed `amount` on each line (asset/expense debits
// are +, credits −; liability/revenue/equity are the mirror — see lib/utils.ts)
// AND that the entry balances (debits == credits). One case per transaction
// type, plus the imbalance-refusal path.

const ACCOUNTS: Record<string, { class: GLAccountClass }> = {
  card: { class: "Liability" },
  bank: { class: "Asset" },
  income: { class: "Revenue" },
  exp1: { class: "Expense" },
  exp2: { class: "Expense" },
};

const line = <T extends { accountId: string }>(
  lines: T[],
  accountId: string
) => lines.find((l) => l.accountId === accountId);

// A journal balances in debit/credit space when the natural-signed amounts,
// re-projected to debit(+)/credit(−) by account class, sum to ~0. Simpler here:
// re-derive from the known account classes.
const debitCreditBalance = (
  lines: { accountId: string; amount: number }[]
) =>
  lines.reduce((sum, l) => {
    const cls = ACCOUNTS[l.accountId].class;
    // Asset/Expense: stored amount already equals its debit-signed value.
    // Liability/Equity/Revenue: stored amount is the negation of debit-signed.
    const debitSigned =
      cls === "Asset" || cls === "Expense" ? l.amount : -l.amount;
    return sum + debitSigned;
  }, 0);

const base = (
  over: Partial<BuildCardTransactionJournalInput> = {}
): BuildCardTransactionJournalInput => ({
  transaction: {
    type: "Charge",
    amount: 100,
    cardAccountId: "card",
    offsetAccountId: null,
    currencyCode: "USD",
    exchangeRate: 1,
    ...(over.transaction ?? {}),
  },
  lines: over.lines ?? [],
  accounts: over.accounts ?? ACCOUNTS,
  documentId: over.documentId ?? "ct_1",
  documentReadableId: over.documentReadableId ?? "CT000001",
});

// ---------------------------------------------------------------------------
// Charge — expense lines debited, card liability credited.
// ---------------------------------------------------------------------------

Deno.test("Charge with two split lines: DR each expense / CR card liability", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1,
      },
      lines: [
        { accountId: "exp1", amount: 60, costCenterId: "cc_1" },
        { accountId: "exp2", amount: 40 },
      ],
    })
  );

  assertEquals(journalLines.length, 3);
  assertEquals(line(journalLines, "exp1")!.amount, 60); // debit expense
  assertEquals(line(journalLines, "exp1")!.costCenterId, "cc_1");
  assertEquals(line(journalLines, "exp1")!.documentType, "Card Transaction");
  assertEquals(line(journalLines, "exp1")!.documentId, "ct_1");
  assertEquals(line(journalLines, "exp2")!.amount, 40); // debit expense
  assertEquals(line(journalLines, "exp2")!.costCenterId, null);
  assertEquals(line(journalLines, "card")!.amount, 100); // credit liability → +
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Credit — mirror image of a Charge.
// ---------------------------------------------------------------------------

Deno.test("Credit: CR expense line / DR card liability", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Credit",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1,
      },
      lines: [{ accountId: "exp1", amount: 100 }],
    })
  );

  assertEquals(journalLines.length, 2);
  assertEquals(line(journalLines, "exp1")!.amount, -100); // credit expense → −
  assertEquals(line(journalLines, "card")!.amount, -100); // debit liability → −
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Payment — pay down the card liability from the bank asset.
// ---------------------------------------------------------------------------

Deno.test("Payment: DR card liability / CR bank asset", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Payment",
        amount: 500,
        cardAccountId: "card",
        offsetAccountId: "bank",
        currencyCode: "USD",
        exchangeRate: 1,
      },
    })
  );

  assertEquals(journalLines.length, 2);
  assertEquals(line(journalLines, "card")!.amount, -500); // debit liability → −
  assertEquals(line(journalLines, "bank")!.amount, -500); // credit asset → −
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Cashback — reduce the card liability, book the offset as income.
// ---------------------------------------------------------------------------

Deno.test("Cashback: DR card liability / CR revenue", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Cashback",
        amount: 25,
        cardAccountId: "card",
        offsetAccountId: "income",
        currencyCode: "USD",
        exchangeRate: 1,
      },
    })
  );

  assertEquals(journalLines.length, 2);
  assertEquals(line(journalLines, "card")!.amount, -25); // debit liability → −
  assertEquals(line(journalLines, "income")!.amount, 25); // credit revenue → +
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Repayment — offset debited for the total, each line credited.
// ---------------------------------------------------------------------------

Deno.test("Repayment: DR bank offset / CR card liability line", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Repayment",
        amount: 300,
        cardAccountId: "card",
        offsetAccountId: "bank",
        currencyCode: "USD",
        exchangeRate: 1,
      },
      lines: [{ accountId: "card", amount: 300 }],
    })
  );

  assertEquals(journalLines.length, 2);
  assertEquals(line(journalLines, "bank")!.amount, 300); // debit asset → +
  assertEquals(line(journalLines, "card")!.amount, 300); // credit liability → +
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Imbalance refusal — line sum must equal the header amount.
// ---------------------------------------------------------------------------

Deno.test("throws when the line sum does not equal the header amount", () => {
  assertThrows(
    () =>
      buildCardTransactionJournal(
        base({
          transaction: {
            type: "Charge",
            amount: 100,
            cardAccountId: "card",
            offsetAccountId: null,
            currencyCode: "USD",
            exchangeRate: 1,
          },
          lines: [
            { accountId: "exp1", amount: 60 },
            { accountId: "exp2", amount: 30 }, // 90 ≠ 100
          ],
        })
      ),
    Error,
    "does not equal header amount"
  );
});

// ---------------------------------------------------------------------------
// FX — exchangeRate ≠ 1 must scale BOTH sides to base currency, or the entry
// silently posts foreign face value / unbalances. A regression that scaled only
// the coding lines (or only the card side) fails here.
// ---------------------------------------------------------------------------

Deno.test("Charge at exchangeRate 2: both the lines AND the card credit scale to base", () => {
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 100,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "EUR",
        exchangeRate: 2,
      },
      lines: [
        { accountId: "exp1", amount: 60 },
        { accountId: "exp2", amount: 40 },
      ],
    })
  );

  assertEquals(journalLines.length, 3);
  assertEquals(line(journalLines, "exp1")!.amount, 120); // 60 × 2 → base debit
  assertEquals(line(journalLines, "exp2")!.amount, 80); // 40 × 2 → base debit
  assertEquals(line(journalLines, "card")!.amount, 200); // 100 × 2 → base credit
  assert(Math.abs(debitCreditBalance(journalLines)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Split rounding — the card/offset side is the SUM of the rounded per-line
// magnitudes, NOT round(total): three lines that each round down leave the card
// side at 0.99999, and the entry still balances exactly. A regression computing
// the card side from round(header) would post 1.0 here and this pins it.
// ---------------------------------------------------------------------------

Deno.test("Charge with three rounding lines: card side = Σ rounded lines, balances exactly", () => {
  const accounts: Record<string, { class: GLAccountClass }> = {
    card: { class: "Liability" },
    exp1: { class: "Expense" },
    exp2: { class: "Expense" },
    exp3: { class: "Expense" },
  };
  const { journalLines } = buildCardTransactionJournal(
    base({
      transaction: {
        type: "Charge",
        amount: 1,
        cardAccountId: "card",
        offsetAccountId: null,
        currencyCode: "USD",
        exchangeRate: 1,
      },
      lines: [
        { accountId: "exp1", amount: 0.333333 },
        { accountId: "exp2", amount: 0.333333 },
        { accountId: "exp3", amount: 0.333334 },
      ],
      accounts,
    })
  );

  // Each line rounds to 0.33333 at internal scale; the card credit is their sum
  // (0.99999), NOT round(header) = 1.0 — so the split balances exactly.
  assertEquals(line(journalLines, "exp1")!.amount, 0.33333);
  assertEquals(line(journalLines, "exp2")!.amount, 0.33333);
  assertEquals(line(journalLines, "exp3")!.amount, 0.33333);
  assertEquals(line(journalLines, "card")!.amount, 0.99999);
  // Re-derive balance against this test's own account map.
  const balance = journalLines.reduce((sum, l) => {
    const cls = accounts[l.accountId].class;
    return sum + (cls === "Expense" ? l.amount : -l.amount);
  }, 0);
  assert(Math.abs(balance) < 1e-9);
});
