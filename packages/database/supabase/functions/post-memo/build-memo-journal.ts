// Pure construction of the GL journal for posting a credit/debit memo. No DB, no
// I/O, no clock — so it is unit-testable with `deno test`. The driver
// (`index.ts`) resolves the control + reason account ids, the reason account's
// class, the accounting period and `journalLineReference` (all impure), then
// hands them here to compute the balanced two-line double-entry.
//
// A memo is payment-shaped, NOT invoice-shaped: it moves an amount between the
// party's AR/AP control account and a single chosen reason account. There are
// four combos (customer/supplier × credit/debit); two axes drive the posting:
//   * isAR      — customer (AR, asset control) vs supplier (AP, liability control)
//   * direction — 'Credit' or 'Debit'. This alone decides the control side:
//                 a Debit memo DEBITS the control account, a Credit memo CREDITS
//                 it — for BOTH AR and AP. Worked through:
//                   Customer Credit  → reduce AR  → CR asset   (control credit)
//                   Customer Debit   → increase AR→ DR asset   (control debit)
//                   Supplier Credit  → increase AP→ CR liab.   (control credit)
//                   Supplier Debit   → reduce AP  → DR liab.   (control debit)
//                 i.e. controlIsDebit === (direction === 'Debit') universally.
// The reason leg is always the inverse side, booked at the reason account's
// natural class so its stored natural-balance `amount` sign is correct.
//
// A memo is a single-currency document booked at its own exchange rate, so there
// is no realized FX at post time (FX only realizes when CASH later settles the
// memo — a separate payment posting). Both legs use the same base amount, so the
// entry balances exactly.

import { credit, debit } from "../lib/utils.ts";

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

// glAccountClass (Asset|Liability|Equity|Revenue|Expense) → the lowercase
// AccountType the debit/credit helpers expect.
export function accountTypeFromClass(glClass: string): AccountType {
  switch (glClass) {
    case "Asset":
      return "asset";
    case "Liability":
      return "liability";
    case "Equity":
      return "equity";
    case "Revenue":
      return "revenue";
    case "Expense":
      return "expense";
    default:
      throw new Error(`Unknown GL account class: ${glClass}`);
  }
}

// A journal line this builder emits. Self-contained — a pure unit shouldn't
// depend on the generated DB types, and `journalLine.documentType`'s "Memo" enum
// value (migration 20260628143012) isn't in the generated lib/types.ts until the
// DB is rebuilt. The driver spreads `journalId` on before the Kysely insert.
export interface MemoJournalLine {
  accountId: string;
  description: string;
  amount: number;
  quantity: number;
  documentType: "Memo";
  documentId: string;
  journalLineReference: string;
  companyId: string;
}

export interface BuildMemoJournalInput {
  // Internal memo record id — becomes `documentId` on every line.
  memoId: string;
  companyId: string;
  // customer (AR) vs supplier (AP). Drives control account TYPE (asset/liability).
  isAR: boolean;
  direction: "Credit" | "Debit";
  // memo.amount × memo.exchangeRate (base currency).
  amountBase: number;
  // Resolved once by the driver (nanoid) so this stays pure.
  journalLineReference: string;
  // receivables (AR) / payables (AP) control account.
  controlAccountId: string;
  // the memo's chosen reason account + its glAccountClass.
  reasonAccountId: string;
  reasonAccountClass: string;
}

export interface BuildMemoJournalResult {
  lines: MemoJournalLine[];
  // Running debit(+)/credit(−) balance; ~0 for a balanced entry.
  signedDebitTotal: number;
}

// Maximum residual (base ccy) we tolerate before refusing to post.
const BALANCE_TOLERANCE = 0.01;

export function buildMemoJournal(
  input: BuildMemoJournalInput
): BuildMemoJournalResult {
  const {
    memoId,
    companyId,
    isAR,
    direction,
    amountBase,
    journalLineReference,
    controlAccountId,
    reasonAccountId,
    reasonAccountClass,
  } = input;

  if (!controlAccountId) {
    throw new Error(
      `Missing ${isAR ? "receivables" : "payables"} account default; cannot post memo to GL`
    );
  }

  const magnitude = round4(Math.abs(amountBase));
  if (magnitude < 0.0001) {
    throw new Error("Memo amount must be greater than 0 to post");
  }

  const lines: MemoJournalLine[] = [];
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: AccountType,
    accountId: string,
    description: string
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    lines.push({
      accountId,
      description,
      amount:
        side === "debit"
          ? debit(accountType, magnitude)
          : credit(accountType, magnitude),
      quantity: 1,
      documentType: "Memo",
      documentId: memoId,
      journalLineReference,
      companyId,
    });
  };

  // Control side is decided by direction alone (see header note).
  const controlIsDebit = direction === "Debit";
  const controlType: AccountType = isAR ? "asset" : "liability";
  const reasonType = accountTypeFromClass(reasonAccountClass);

  // 1) Control leg (AR/AP).
  pushLine(
    controlIsDebit ? "debit" : "credit",
    controlType,
    controlAccountId,
    isAR ? "Accounts Receivable" : "Accounts Payable"
  );

  // 2) Reason leg — always the inverse side, so the entry balances.
  pushLine(
    controlIsDebit ? "credit" : "debit",
    reasonType,
    reasonAccountId,
    direction === "Credit" ? "Credit memo" : "Debit memo"
  );

  if (Math.abs(signedDebitTotal) > BALANCE_TOLERANCE) {
    throw new Error(
      `Memo journal does not balance (off by ${round4(signedDebitTotal)} in base currency); refusing to post`
    );
  }

  return { lines, signedDebitTotal };
}
