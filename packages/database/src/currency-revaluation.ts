// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The unrealized FX revaluation of open foreign-currency exposures at a
// period end. Pure: no database, no clock, no rate lookup. The caller loads
// the exposures and the rate per currency, and writes the journals: the
// valuation at the period end and its reversal on the next day.

import { toBaseAmount } from "./accounting-currency.ts";
import {
  type AccountType,
  accountTypeFromClass,
  credit,
  debit
} from "./ledger.ts";
import { assertBalanced, round } from "./precision.ts";
import type { RunJournal, RunJournalLine } from "./run-journals.ts";
import type { Database } from "./types.ts";

type Enums = Database["public"]["Enums"];

export type ExposureType =
  | "Receivable"
  | "Payable"
  | "Unapplied Receipt"
  | "Unapplied Disbursement"
  | "Account Balance";

export type RevaluationExposure = {
  exposureType: ExposureType;
  documentType: Enums["journalLineDocumentType"] | null;
  documentId: string | null;
  documentNumber: string | null;
  /** The adjustment account, or the balance account. */
  accountId: string;
  accountClass: "Asset" | "Liability";
  currencyCode: string;
  /** Document currency, natural sign; null = not entered. */
  openAmount: number | null;
  /** Base, natural sign. */
  bookedBaseAmount: number;
};

export type RevaluedLine = RevaluationExposure & {
  revaluedBaseAmount: number | null;
  /** Positive = gain. */
  differenceAmount: number | null;
};

/**
 * Whether a rise in the exposure's base value is a gain (1) or a loss (−1):
 * a rise in what is owed to the company is a gain, a rise in what it owes is
 * a loss.
 */
export function exposureSide(exposure: RevaluationExposure): 1 | -1 {
  switch (exposure.exposureType) {
    case "Receivable":
    case "Unapplied Disbursement":
      return 1;
    case "Payable":
    case "Unapplied Receipt":
      return -1;
    case "Account Balance":
      return exposure.accountClass === "Asset" ? 1 : -1;
  }
}

/** The exposure's base value at `rate` (foreign units per base unit) and
 *  its difference from the booked base value. */
export function revalueExposure(
  exposure: RevaluationExposure,
  rate: number
): RevaluedLine {
  if (exposure.openAmount === null) {
    return { ...exposure, revaluedBaseAmount: null, differenceAmount: null };
  }
  const revaluedBaseAmount = toBaseAmount(exposure.openAmount, rate);
  return {
    ...exposure,
    revaluedBaseAmount,
    differenceAmount: round(
      exposureSide(exposure) * (revaluedBaseAmount - exposure.bookedBaseAmount)
    )
  };
}

/**
 * The valuation journal and its reversal. One line per revalued exposure
 * with a difference, on its own account (a gain is a debit, a loss a
 * credit), then one credit to the gain account for the gains and one debit
 * to the loss account for the losses. The reversal negates every line.
 * Throws when either journal does not balance.
 */
export function buildCurrencyRevaluationJournals(args: {
  readableId: string;
  lines: RevaluedLine[];
  gainAccountId: string;
  lossAccountId: string;
}): { valuation: RunJournal; reversal: RunJournal } {
  const { readableId, lines, gainAccountId, lossAccountId } = args;

  const valuationLines: RunJournalLine[] = [];
  // Each line's account type, by index, to recover its debit or credit.
  const accountTypes: AccountType[] = [];
  let gains = 0;
  let losses = 0;
  for (const line of lines) {
    const difference = line.differenceAmount;
    if (difference === null || difference === 0) continue;
    const accountType = accountTypeFromClass(line.accountClass);
    valuationLines.push({
      accountId: line.accountId,
      description: line.documentNumber
        ? `Unrealized FX revaluation: ${line.documentNumber}`
        : "Unrealized FX revaluation",
      amount:
        difference > 0
          ? debit(accountType, difference)
          : credit(accountType, -difference),
      ...(line.documentType ? { documentType: line.documentType } : {}),
      ...(line.documentId ? { documentId: line.documentId } : {}),
      dimensions: {}
    });
    accountTypes.push(accountType);
    if (difference > 0) gains += difference;
    else losses -= difference;
  }
  gains = round(gains);
  losses = round(losses);

  if (gains !== 0) {
    valuationLines.push({
      accountId: gainAccountId,
      description: "Unrealized FX Gain",
      amount: credit("revenue", gains),
      dimensions: {}
    });
    accountTypes.push("revenue");
  }
  if (losses !== 0) {
    valuationLines.push({
      accountId: lossAccountId,
      description: "Unrealized FX Loss",
      amount: debit("expense", losses),
      dimensions: {}
    });
    accountTypes.push("expense");
  }

  const reversalLines = valuationLines.map((line) => ({
    ...line,
    amount: -line.amount
  }));
  assertJournalBalanced(
    valuationLines,
    accountTypes,
    "Currency revaluation journal"
  );
  assertJournalBalanced(
    reversalLines,
    accountTypes,
    "Currency revaluation reversal"
  );

  return {
    valuation: {
      description: `Currency revaluation ${readableId}`,
      sourceType: "Currency Revaluation",
      lines: valuationLines
    },
    reversal: {
      description: `Reversal of ${readableId}`,
      sourceType: "Currency Revaluation",
      lines: reversalLines
    }
  };
}

/** Sum the debits and credits of natural-signed lines and refuse an
 *  imbalance. `debit` is its own inverse: on a natural-signed amount it
 *  gives the debit-signed value (positive = debit). */
function assertJournalBalanced(
  lines: RunJournalLine[],
  accountTypes: AccountType[],
  label: string
): void {
  let debits = 0;
  let credits = 0;
  lines.forEach((line, index) => {
    const debitSigned = debit(accountTypes[index]!, line.amount);
    if (debitSigned > 0) debits += debitSigned;
    else credits -= debitSigned;
  });
  assertBalanced(debits, credits, undefined, label);
}
