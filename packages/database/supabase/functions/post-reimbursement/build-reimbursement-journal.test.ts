import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildReimbursementJournal,
  type BuildReimbursementJournalInput,
  type GLAccountClass,
} from "./build-reimbursement-journal.ts";

// Golden-master tests for the GL journal an employee reimbursement posts. Each
// asserts the exact natural-balance-signed `amount` on each line (expense
// debits are +, liability credits are + — see lib/utils.ts) AND that the entry
// balances (debits == credits), plus the refusal paths.

const ACCOUNTS: Record<string, { class: GLAccountClass }> = {
  payable: { class: "Liability" },
  ap: { class: "Liability" },
  bank: { class: "Asset" },
  exp1: { class: "Expense" },
  exp2: { class: "Expense" },
};

const line = <T extends { accountId: string }>(
  lines: T[],
  accountId: string,
) => lines.find((l) => l.accountId === accountId);

// A journal balances in debit/credit space when the natural-signed amounts,
// re-projected to debit(+)/credit(−) by account class, sum to ~0.
const debitCreditBalance = (
  lines: { accountId: string; amount: number }[],
) =>
  lines.reduce((sum, l) => {
    const cls = ACCOUNTS[l.accountId].class;
    // Asset/Expense: stored amount already equals its debit-signed value.
    // Liability/Equity/Revenue: stored amount is the negation of debit-signed.
    const debitSigned = cls === "Asset" || cls === "Expense"
      ? l.amount
      : -l.amount;
    return sum + debitSigned;
  }, 0);

const totals = (lines: { accountId: string; amount: number }[]) =>
  lines.reduce(
    (acc, l) => {
      const cls = ACCOUNTS[l.accountId].class;
      const debitSigned = cls === "Asset" || cls === "Expense"
        ? l.amount
        : -l.amount;
      return debitSigned >= 0
        ? { ...acc, totalDebits: acc.totalDebits + debitSigned }
        : { ...acc, totalCredits: acc.totalCredits - debitSigned };
    },
    { totalDebits: 0, totalCredits: 0 },
  );

const base = (
  over: Partial<BuildReimbursementJournalInput> = {},
): BuildReimbursementJournalInput => ({
  reimbursement: {
    amount: 620,
    payableAccountId: "payable",
    currencyCode: "USD",
    exchangeRate: 1,
    ...(over.reimbursement ?? {}),
  },
  lines: over.lines ?? [
    { accountId: "exp1", amount: 500 },
    { accountId: "exp2", amount: 120 },
  ],
  accounts: over.accounts ?? ACCOUNTS,
  documentId: over.documentId ?? "reimb_1",
  documentReadableId: over.documentReadableId ?? "RB000001",
});

// ---------------------------------------------------------------------------
// AC1 — coding lines debited, employee payable credited for the total.
// ---------------------------------------------------------------------------

Deno.test("two coding lines: DR each expense / CR employee payable", () => {
  const { journalLines } = buildReimbursementJournal(base());

  assertEquals(journalLines.length, 3);
  assertEquals(line(journalLines, "exp1")!.amount, 500); // debit expense
  assertEquals(line(journalLines, "exp2")!.amount, 120); // debit expense
  // A POSITIVE amount on a Liability account is a CREDIT.
  assertEquals(line(journalLines, "payable")!.amount, 620);
  assertEquals(
    line(journalLines, "payable")!.description,
    "Employee reimbursement payable",
  );
  assertEquals(line(journalLines, "exp1")!.documentType, "Reimbursement");
  assertEquals(line(journalLines, "exp1")!.documentId, "reimb_1");
  assertEquals(
    line(journalLines, "exp1")!.description,
    "Employee reimbursement",
  );
  assertEquals(debitCreditBalance(journalLines), 0);
  assertEquals(totals(journalLines), { totalDebits: 620, totalCredits: 620 });
});

Deno.test("a line description overrides the default", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      lines: [
        { accountId: "exp1", amount: 500, description: "Client dinner" },
        { accountId: "exp2", amount: 120 },
      ],
    }),
  );
  assertEquals(line(journalLines, "exp1")!.description, "Client dinner");
  assertEquals(
    line(journalLines, "exp2")!.description,
    "Employee reimbursement",
  );
});

// ---------------------------------------------------------------------------
// AC2 — the AP trade fallback must produce the identical, balanced journal.
// ---------------------------------------------------------------------------

Deno.test("AP trade fallback account produces the same balanced journal", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      reimbursement: {
        amount: 620,
        payableAccountId: "ap",
        currencyCode: "USD",
        exchangeRate: 1,
      },
    }),
  );

  assertEquals(journalLines.length, 3);
  assertEquals(line(journalLines, "ap")!.amount, 620);
  assertEquals(line(journalLines, "exp1")!.amount, 500);
  assertEquals(line(journalLines, "exp2")!.amount, 120);
  assertEquals(debitCreditBalance(journalLines), 0);
  assertEquals(totals(journalLines), { totalDebits: 620, totalCredits: 620 });
});

// ---------------------------------------------------------------------------
// Dimensions ride the line they were coded on — and only that line.
// ---------------------------------------------------------------------------

Deno.test("costCenterId and projectId ride only their own line", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      lines: [
        {
          accountId: "exp1",
          amount: 500,
          costCenterId: "cc_1",
          projectId: "pj_1",
        },
        { accountId: "exp2", amount: 120 },
      ],
    }),
  );

  assertEquals(line(journalLines, "exp1")!.costCenterId, "cc_1");
  assertEquals(line(journalLines, "exp1")!.projectId, "pj_1");
  assertEquals(line(journalLines, "exp2")!.costCenterId, null);
  assertEquals(line(journalLines, "exp2")!.projectId, null);
  // The payable leg is a control account — it never carries line coding.
  assertEquals(line(journalLines, "payable")!.costCenterId, null);
  assertEquals(line(journalLines, "payable")!.projectId, null);
});

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

Deno.test("a line sum that disagrees with the header refuses to post", () => {
  assertThrows(
    () =>
      buildReimbursementJournal(
        base({
          lines: [
            { accountId: "exp1", amount: 500 },
            { accountId: "exp2", amount: 100 },
          ],
        }),
      ),
    Error,
    "line sum 600 does not equal header amount 620",
  );
});

Deno.test("no coding lines refuses to post", () => {
  assertThrows(
    () => buildReimbursementJournal(base({ lines: [] })),
    Error,
    "requires at least one line",
  );
});

Deno.test("a zero or negative line amount refuses to post", () => {
  for (const amount of [0, -120]) {
    assertThrows(
      () =>
        buildReimbursementJournal(
          base({
            lines: [
              { accountId: "exp1", amount: 620 },
              { accountId: "exp2", amount },
            ],
          }),
        ),
      Error,
      "must be finite and greater than zero",
    );
  }
});

Deno.test("an unknown account id refuses to post", () => {
  assertThrows(
    () =>
      buildReimbursementJournal(
        base({ lines: [{ accountId: "unknown", amount: 620 }] }),
      ),
    Error,
    "missing account class for unknown",
  );
  assertThrows(
    () =>
      buildReimbursementJournal(
        base({
          reimbursement: {
            amount: 620,
            payableAccountId: "missing-payable",
            currencyCode: "USD",
            exchangeRate: 1,
          },
        }),
      ),
    Error,
    "missing account class for missing-payable",
  );
});

// ---------------------------------------------------------------------------
// Foreign currency — every magnitude DIVIDED by the rate, still balanced.
// ---------------------------------------------------------------------------

Deno.test("exchangeRate 1.25 divides every magnitude and still balances", () => {
  const { journalLines } = buildReimbursementJournal(
    base({
      reimbursement: {
        amount: 620,
        payableAccountId: "payable",
        currencyCode: "EUR",
        exchangeRate: 1.25,
      },
    }),
  );

  assertEquals(line(journalLines, "exp1")!.amount, 400); // 500 / 1.25
  assertEquals(line(journalLines, "exp2")!.amount, 96); // 120 / 1.25
  assertEquals(line(journalLines, "payable")!.amount, 496);
  assertEquals(debitCreditBalance(journalLines), 0);
  assertEquals(totals(journalLines), { totalDebits: 496, totalCredits: 496 });
});

Deno.test("a corrupt exchange rate refuses to post", () => {
  for (const exchangeRate of [0, -1, Number.NaN]) {
    assertThrows(
      () =>
        buildReimbursementJournal(
          base({
            reimbursement: {
              amount: 620,
              payableAccountId: "payable",
              currencyCode: "EUR",
              exchangeRate,
            },
          }),
        ),
      Error,
    );
  }
});
