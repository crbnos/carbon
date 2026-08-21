// Pure construction of the GL journal for posting a card transaction (Ramp and
// other card integrations). No DB, no I/O, no clock — so it is unit-testable
// with `deno test`. The driver (`index.ts`) resolves the account classes,
// accounting period, journalLineReference and cost-center dimensions (all
// impure), then hands the shaped inputs here to compute the balanced
// double-entry. Keeping this pure is what lets the golden-master tests pin the
// exact journal for every transaction type — the lines that hit the general
// ledger must be provably correct, not merely inspected.
//
// Amounts are NATURAL-BALANCE-SIGNED via the `credit()`/`debit()` helpers from
// `../lib/utils.ts` (lessons.md: Carbon journal amounts are natural-signed, not
// debit-signed — `credit("liability", x)` stores `+x`, `credit("asset", x)`
// stores `−x`). A balanced entry therefore has debits == credits, and does NOT
// sum to zero in the stored `amount`; we track a separate debit(+)/credit(−)
// balance and assert on it.
//
// The card account itself is always a LIABILITY (a credit card is money owed),
// so its side is booked with the hard-coded "liability" class. The offset and
// per-line accounts take their class from the resolved `accounts` map — except
// Cashback, whose offset is booked to Revenue by definition (a rebate is income).

import { assertBalanced, EPSILON, round } from "../shared/precision.ts";
import { credit, debit } from "../lib/utils.ts";

export type GLAccountClass =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

// The lowercase form the credit()/debit() helpers accept.
type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type CardTransactionType =
  | "Charge"
  | "Credit"
  | "Payment"
  | "Cashback"
  | "Repayment";

export interface CardTransactionLineInput {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  description?: string | null;
}

export interface BuildCardTransactionJournalInput {
  transaction: {
    type: CardTransactionType;
    amount: number;
    cardAccountId: string;
    offsetAccountId: string | null;
    currencyCode: string;
    exchangeRate: number;
  };
  lines: CardTransactionLineInput[];
  // Resolved account classes, keyed by accountId. Only the accounts this
  // transaction touches need be present.
  accounts: Record<string, { class: GLAccountClass }>;
  // Internal cardTransaction record id — becomes `documentId` on every line.
  documentId: string;
  // Human-readable id (cardTransactionId) — used only in error messages.
  documentReadableId: string;
}

// A journal line this builder emits. Deliberately self-contained — a pure unit
// shouldn't depend on the generated DB types. The driver adds `journalId`,
// `journalLineReference`, `companyId` and `quantity` before the Kysely insert,
// and consumes `costCenterId` to write the CostCenter journalLineDimension.
export interface CardTransactionJournalLine {
  accountId: string;
  amount: number;
  description: string;
  documentType: "Card Transaction";
  documentId: string;
  costCenterId?: string | null;
}

export interface BuildCardTransactionJournalResult {
  journalLines: CardTransactionJournalLine[];
}

// Maximum residual (base ccy) tolerated before refusing to post. Above this a
// logic/rounding bug has produced an unbalanced entry. Matches post-payment's
// business threshold (multi-currency journals carry sub-cent cross-rate
// residuals), NOT the float-noise EPSILON.
const BALANCE_TOLERANCE = 0.01;

export function buildCardTransactionJournal(
  input: BuildCardTransactionJournalInput
): BuildCardTransactionJournalResult {
  const { transaction, lines, accounts, documentId, documentReadableId } = input;
  const { type, amount, cardAccountId, offsetAccountId, exchangeRate } =
    transaction;

  // Journal lines hit the GL in base currency. Both sides scale by the same
  // rate so the entry stays balanced; the offset/card side accumulates the
  // rounded per-line magnitudes so rounding dust can never unbalance a split.
  const rate = exchangeRate || 1;
  const toBase = (value: number) => round(value * rate);

  const classOf = (accountId: string): AccountType => {
    const account = accounts[accountId];
    if (!account) {
      throw new Error(
        `Card transaction ${documentReadableId}: missing account class for ${accountId}`
      );
    }
    return account.class.toLowerCase() as AccountType;
  };

  const journalLines: CardTransactionJournalLine[] = [];
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
    }
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    journalLines.push({
      accountId: fields.accountId,
      amount:
        side === "debit"
          ? debit(accountType, magnitude)
          : credit(accountType, magnitude),
      description: fields.description,
      documentType: "Card Transaction",
      documentId,
      costCenterId: fields.costCenterId ?? null,
    });
  };

  // Line-bearing types must have lines that sum to the header amount, or the
  // subledger and the GL disagree. Throw a typed error naming the mismatch.
  const requireLineSum = () => {
    if (lines.length === 0) {
      throw new Error(
        `Card transaction ${documentReadableId}: ${type} requires at least one line`
      );
    }
    const lineSum = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(lineSum - amount) > EPSILON) {
      throw new Error(
        `Card transaction ${documentReadableId}: line sum ${lineSum} does not equal header amount ${amount}`
      );
    }
  };

  const requireOffset = (): string => {
    if (!offsetAccountId) {
      throw new Error(
        `Card transaction ${documentReadableId}: ${type} requires an offset account`
      );
    }
    return offsetAccountId;
  };

  switch (type) {
    // Purchase on the card: expense/asset lines debited, card liability
    // credited for the total.
    case "Charge": {
      requireLineSum();
      let cardMagnitude = 0;
      for (const line of lines) {
        const magnitude = toBase(line.amount);
        cardMagnitude += magnitude;
        pushLine("debit", classOf(line.accountId), magnitude, {
          accountId: line.accountId,
          description: line.description ?? "Card charge",
          costCenterId: line.costCenterId,
        });
      }
      pushLine("credit", "liability", cardMagnitude, {
        accountId: cardAccountId,
        description: "Card liability",
      });
      break;
    }

    // Refund/return to the card — mirror image of a Charge.
    case "Credit": {
      requireLineSum();
      let cardMagnitude = 0;
      for (const line of lines) {
        const magnitude = toBase(line.amount);
        cardMagnitude += magnitude;
        pushLine("credit", classOf(line.accountId), magnitude, {
          accountId: line.accountId,
          description: line.description ?? "Card credit",
          costCenterId: line.costCenterId,
        });
      }
      pushLine("debit", "liability", cardMagnitude, {
        accountId: cardAccountId,
        description: "Card liability",
      });
      break;
    }

    // Statement payment: pay down the card liability from a bank asset.
    case "Payment": {
      const offset = requireOffset();
      const magnitude = toBase(amount);
      pushLine("debit", "liability", magnitude, {
        accountId: cardAccountId,
        description: "Card liability",
      });
      pushLine("credit", classOf(offset), magnitude, {
        accountId: offset,
        description: "Card payment",
      });
      break;
    }

    // Cashback/rewards: reduce the card liability, book the offset as income.
    case "Cashback": {
      const offset = requireOffset();
      const magnitude = toBase(amount);
      pushLine("debit", "liability", magnitude, {
        accountId: cardAccountId,
        description: "Card liability",
      });
      pushLine("credit", "revenue", magnitude, {
        accountId: offset,
        description: "Card cashback",
      });
      break;
    }

    // Repayment: the offset (bank asset or card liability, per funding) is
    // debited for the total; each line account is credited.
    case "Repayment": {
      requireLineSum();
      const offset = requireOffset();
      const lineMagnitudes = lines.map((l) => toBase(l.amount));
      const offsetMagnitude = lineMagnitudes.reduce((sum, m) => sum + m, 0);
      pushLine("debit", classOf(offset), offsetMagnitude, {
        accountId: offset,
        description: "Card repayment",
      });
      lines.forEach((line, index) => {
        pushLine("credit", classOf(line.accountId), lineMagnitudes[index], {
          accountId: line.accountId,
          description: line.description ?? "Card repayment",
          costCenterId: line.costCenterId,
        });
      });
      break;
    }

    default: {
      // Exhaustiveness guard — a new cardTransactionType must add a branch here.
      throw new Error(
        `Card transaction ${documentReadableId}: unsupported type ${type as string}`
      );
    }
  }

  // Self-check: the entry must balance in true debit/credit space, or we refuse
  // to post rather than write an unbalanced journal to the GL.
  assertBalanced(signedDebitTotal, 0, BALANCE_TOLERANCE, "Card transaction journal");

  return { journalLines };
}
