// Pure construction of the GL journal for posting an employee reimbursement.
// No DB, no I/O, no clock — so it is unit-testable with `deno test`. The
// posting transaction resolves the account classes, the payable control
// account, the accounting period, the journalLineReference and the dimensions
// (all impure), then hands the shaped inputs here to compute the balanced
// double-entry. Keeping this pure is what lets the golden-master tests pin the
// exact journal — the lines that hit the general ledger must be provably
// correct, not merely inspected.
//
// Amounts are NATURAL-BALANCE-SIGNED via the `credit()`/`debit()` helpers from
// `../lib/utils.ts` (lessons.md: Carbon journal amounts are natural-signed, not
// debit-signed — `credit("liability", x)` stores `+x`, `credit("asset", x)`
// stores `−x`). A balanced entry therefore has debits == credits, and does NOT
// sum to zero in the stored `amount`; we track a separate debit(+)/credit(−)
// balance and assert on it.
//
// Unlike a charge there is exactly ONE shape: every coding line is DEBITED and
// the employee-payable control account is CREDITED for the total. The payable
// side takes its class from the resolved `accounts` map rather than a
// hard-coded "liability" — the AP trade account the driver falls back to when
// `employeeReimbursementsPayableAccount` is unset is also a Liability, but
// taking the class from the resolved account is what makes a mis-classed
// default fail loudly instead of posting the wrong side.

import { assertBalanced, EPSILON } from "../shared/precision.ts";
import {
  assertExchangeRate,
  toBaseAmount,
} from "../shared/accounting-currency.ts";
import { credit, debit } from "../lib/utils.ts";

export type GLAccountClass =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

// The lowercase form the credit()/debit() helpers accept.
type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface ReimbursementLineInput {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  projectId?: string | null;
  description?: string | null;
}

export interface BuildReimbursementJournalInput {
  reimbursement: {
    amount: number;
    payableAccountId: string;
    currencyCode: string;
    exchangeRate: number;
  };
  // Resolved account classes, keyed by accountId. Only the accounts this
  // reimbursement touches need be present.
  accounts: Record<string, { class: GLAccountClass }>;
  lines: ReimbursementLineInput[];
  // Internal reimbursement record id — becomes `documentId` on every line.
  documentId: string;
  // Human-readable id (reimbursementId) — used only in error messages.
  documentReadableId: string;
}

// A journal line this builder emits. Deliberately self-contained — a pure unit
// shouldn't depend on the generated DB types. The driver adds `journalId`,
// `journalLineReference`, `companyId` and `quantity` before the Kysely insert,
// and consumes `costCenterId`/`projectId` to write the journalLineDimension
// rows.
export interface ReimbursementJournalLine {
  accountId: string;
  amount: number;
  description: string;
  documentType: "Reimbursement";
  documentId: string;
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface BuildReimbursementJournalResult {
  journalLines: ReimbursementJournalLine[];
}

// Maximum residual (base ccy) tolerated before refusing to post. Above this a
// logic/rounding bug has produced an unbalanced entry. Matches post-payment's
// business threshold (multi-currency journals carry sub-cent cross-rate
// residuals), NOT the float-noise EPSILON.
const BALANCE_TOLERANCE = 0.01;

export function buildReimbursementJournal(
  input: BuildReimbursementJournalInput,
): BuildReimbursementJournalResult {
  const { reimbursement, lines, accounts, documentId, documentReadableId } =
    input;
  const { amount, payableAccountId, exchangeRate } = reimbursement;

  // Journal lines hit the GL in base currency. `exchangeRate` is the canonical
  // foreign-per-base rate (units of the document currency per 1 unit of base,
  // via get_exchange_rate; base currency → 1), so a document amount converts to
  // base by DIVIDING — the shared `toBaseAmount`, which rounds once per call at
  // internal SCALE. The payable side accumulates the SAME rounded per-line
  // magnitudes as the coding lines, so rounding dust can never unbalance a
  // split. The column is NOT NULL default 1 (> 0), so this guard passes for the
  // rate=1 base-currency fallback and only refuses a corrupt (0 / negative /
  // non-finite) rate before it can post.
  assertExchangeRate(exchangeRate);
  const toBase = (value: number) => toBaseAmount(value, exchangeRate);

  const classOf = (accountId: string): AccountType => {
    const account = accounts[accountId];
    if (!account) {
      throw new Error(
        `Reimbursement ${documentReadableId}: missing account class for ${accountId}`,
      );
    }
    return account.class.toLowerCase() as AccountType;
  };

  const journalLines: ReimbursementJournalLine[] = [];
  // True debit(+)/credit(−) space. A balanced double entry sums to ~0 here.
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: AccountType,
    magnitude: number,
    fields: {
      accountId: string;
      description: string;
      costCenterId?: string | null;
      projectId?: string | null;
    },
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    journalLines.push({
      accountId: fields.accountId,
      amount: side === "debit"
        ? debit(accountType, magnitude)
        : credit(accountType, magnitude),
      description: fields.description,
      documentType: "Reimbursement",
      documentId,
      costCenterId: fields.costCenterId ?? null,
      projectId: fields.projectId ?? null,
    });
  };

  // The coding lines must sum to the header amount, or the subledger and the GL
  // disagree. This is the invariant the detail page's totals guard mirrors
  // before it will enable Post — the message text below is what a developer
  // sees if that guard is ever bypassed.
  const requireLineSum = () => {
    if (lines.length === 0) {
      throw new Error(
        `Reimbursement ${documentReadableId}: requires at least one line`,
      );
    }
    if (
      lines.some((line) => !Number.isFinite(line.amount) || line.amount <= 0)
    ) {
      throw new Error(
        `Reimbursement ${documentReadableId}: coding line amounts must be finite and greater than zero`,
      );
    }
    const lineSum = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(lineSum - amount) > EPSILON) {
      throw new Error(
        `Reimbursement ${documentReadableId}: line sum ${lineSum} does not equal header amount ${amount}`,
      );
    }
  };

  requireLineSum();

  // Each coding line is debited; the employee payable is credited for the sum
  // of the SAME rounded magnitudes.
  let payableMagnitude = 0;
  for (const line of lines) {
    const magnitude = toBase(line.amount);
    payableMagnitude += magnitude;
    pushLine("debit", classOf(line.accountId), magnitude, {
      accountId: line.accountId,
      description: line.description ?? "Employee reimbursement",
      costCenterId: line.costCenterId,
      projectId: line.projectId,
    });
  }
  pushLine("credit", classOf(payableAccountId), payableMagnitude, {
    accountId: payableAccountId,
    description: "Employee reimbursement payable",
  });

  // Defensive backstop: assert the entry balances in true debit/credit space.
  // By construction the payable leg accumulates the same rounded per-line
  // magnitudes as the coding legs, so this holds by construction today and
  // cannot fire. The real integrity guard is `requireLineSum` (the subledger
  // must equal the header). This assert exists so a future edit that breaks the
  // matched-legs invariant fails loudly here rather than writing an unbalanced
  // journal to the GL.
  assertBalanced(
    signedDebitTotal,
    0,
    BALANCE_TOLERANCE,
    "Reimbursement journal",
  );

  return { journalLines };
}
