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
// memo — a separate payment posting).
//
// Both legs normally use the same base amount, so the entry balances on two
// lines. SUPPLIER RETURNS are the one exception: the return shipment already
// debited GRNI at the goods' CARRIED COST, so the memo must credit GRNI by that
// same carried cost to clear it, while AP moves by what the supplier actually
// agreed to credit. Those two figures are independent, and the difference is a
// purchase price variance — emitted as a third leg. Without it the credit and
// the cost never reconcile and GRNI keeps a permanent residual.

import { assertBalanced, round } from "../shared/precision.ts";
import { credit, debit } from "../lib/utils.ts";

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
  // Supplier-return memos only. The reason leg (GRNI) must clear the EXACT
  // amount the return shipment debited — the carried cost of the goods — not
  // the amount the supplier agreed to credit. When the two differ, the
  // difference is a purchase price variance and needs its own leg, or the
  // suspense account never nets to zero. Omit both for every other memo and
  // the entry stays the ordinary two-line shape.
  reasonAmountBase?: number;
  varianceAccountId?: string | null;
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
    reasonAmountBase,
    varianceAccountId,
  } = input;

  if (!controlAccountId) {
    throw new Error(
      `Missing ${isAR ? "receivables" : "payables"} account default; cannot post memo to GL`
    );
  }

  const magnitude = round(Math.abs(amountBase));
  if (magnitude < 0.0001) {
    throw new Error("Memo amount must be greater than 0 to post");
  }

  const lines: MemoJournalLine[] = [];
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: AccountType,
    accountId: string,
    description: string,
    // Defaults to the memo magnitude; only the reason and variance legs of a
    // supplier return pass their own.
    lineMagnitude: number = magnitude
  ) => {
    signedDebitTotal += side === "debit" ? lineMagnitude : -lineMagnitude;
    lines.push({
      accountId,
      description,
      amount:
        side === "debit"
          ? debit(accountType, lineMagnitude)
          : credit(accountType, lineMagnitude),
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

  // 2) Reason leg — always the inverse side of the control leg.
  //
  // Normally it carries the same magnitude, so the entry balances on two
  // lines. A supplier return is the exception: the reason account (GRNI)
  // must be cleared at the CARRIED COST the return shipment debited, while
  // the control leg (AP) moves by what the supplier actually credited. When
  // those differ, the reason leg uses its own magnitude and the remainder
  // becomes leg 3.
  const reasonMagnitude =
    reasonAmountBase === undefined ? magnitude : round(Math.abs(reasonAmountBase));
  pushLine(
    controlIsDebit ? "credit" : "debit",
    reasonType,
    reasonAccountId,
    direction === "Credit" ? "Credit memo" : "Debit memo",
    reasonMagnitude
  );

  // 3) Variance leg — the plug that makes an unequal control/reason pair
  // balance. Same economic family as the invoice-vs-receipt PPV
  // (`post-purchase-invoice`), so it shares `purchaseVarianceAccount` and is
  // told apart by its own description.
  const varianceMagnitude = round(Math.abs(signedDebitTotal));
  if (varianceMagnitude > 0.005) {
    if (!varianceAccountId) {
      throw new Error(
        "Memo reason amount differs from the memo amount but no variance account was provided; cannot post an unbalanced memo"
      );
    }
    // signedDebitTotal > 0 means debits currently exceed credits, so the plug
    // must be a credit (a gain: credited more than the goods were carried at).
    pushLine(
      signedDebitTotal > 0 ? "credit" : "debit",
      "expense",
      varianceAccountId,
      "Purchase Price Variance",
      varianceMagnitude
    );
  }

  // BALANCE_TOLERANCE is a business threshold (multi-currency memos carry
  // sub-cent cross-rate residuals), NOT the float-noise default.
  assertBalanced(
    signedDebitTotal,
    0,
    BALANCE_TOLERANCE,
    "Memo journal (base currency)"
  );

  return { lines, signedDebitTotal };
}
