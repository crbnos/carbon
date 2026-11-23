// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The prior system's trial balance as a CSV, imported in the accounting enable
// wizard. Pure: the route reads the chart of accounts and saves the lines.

import { parseCsv } from "@carbon/files/csv";

/** The columns the CSV must have, by header name. */
export const TRIAL_BALANCE_CSV_COLUMNS = [
  "accountNumber",
  "debit",
  "credit"
] as const;

type AmountColumn = "debit" | "credit";

/**
 * Why a CSV was not imported. Each error carries what the editor needs to say
 * it in the user's language. `line` is the line in the file; the header is
 * line 1.
 */
export type TrialBalanceCsvError =
  | { code: "empty-file" }
  | { code: "missing-columns"; columns: string[] }
  | { code: "missing-account-number"; line: number }
  | {
      code: "invalid-amount";
      line: number;
      accountNumber: string;
      column: AmountColumn;
      value: string;
    }
  | {
      // A comma in an amount: a decimal comma (1234,56), both separators
      // (1.234,56 or 1,234.56) or a thousands separator (1,234). The import
      // cannot tell them apart, so it refuses them all.
      code: "ambiguous-amount";
      line: number;
      accountNumber: string;
      column: AmountColumn;
      value: string;
    }
  | {
      code: "duplicate-account";
      line: number;
      firstLine: number;
      accountNumber: string;
    }
  | { code: "unknown-account"; accountNumber: string };

/** A row of the CSV, with its amounts. */
export type TrialBalanceCsvRow = {
  line: number;
  accountNumber: string;
  debit: number;
  credit: number;
};

/** A row mapped to its account. */
export type TrialBalanceCsvLine = {
  accountId: string;
  debit: number;
  credit: number;
};

type AmountResult =
  | { amount: number }
  | { error: "invalid-amount" | "ambiguous-amount" };

/**
 * A CSV amount: empty is zero; otherwise digits with an optional point and
 * decimals, zero or more. A comma is refused rather than guessed: `1,234` is
 * a thousand in one convention and one and a fraction in another.
 */
export function parseTrialBalanceAmount(value: unknown): AmountResult {
  const text = String(value ?? "").trim();
  if (text === "") return { amount: 0 };
  if (text.includes(",")) return { error: "ambiguous-amount" };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return { error: "invalid-amount" };
  return { amount: Number(text) };
}

/**
 * The rows of a trial balance CSV with the columns `accountNumber`, `debit`
 * and `credit`, or every reason it cannot be imported. A row may carry both a
 * debit and a credit: the saved journal nets them. An account number on two
 * rows is refused rather than summed.
 */
export function parseTrialBalanceCsv(
  csv: string
):
  | { rows: TrialBalanceCsvRow[]; errors: null }
  | { rows: null; errors: TrialBalanceCsvError[] } {
  const parsed = parseCsv<Record<string, unknown>>(csv);
  const missing = TRIAL_BALANCE_CSV_COLUMNS.filter(
    (column) => !parsed.fields.includes(column)
  );
  if (missing.length > 0) {
    return {
      rows: null,
      errors: [{ code: "missing-columns", columns: missing }]
    };
  }

  const errors: TrialBalanceCsvError[] = [];
  const rows: TrialBalanceCsvRow[] = [];
  const firstLineByAccount = new Map<string, number>();
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const accountNumber = String(row.accountNumber ?? "").trim();
    if (!accountNumber) {
      errors.push({ code: "missing-account-number", line });
      return;
    }

    const firstLine = firstLineByAccount.get(accountNumber);
    if (firstLine !== undefined) {
      errors.push({
        code: "duplicate-account",
        line,
        firstLine,
        accountNumber
      });
      return;
    }
    firstLineByAccount.set(accountNumber, line);

    const amounts: Partial<Record<AmountColumn, number>> = {};
    for (const column of ["debit", "credit"] as const) {
      const result = parseTrialBalanceAmount(row[column]);
      if ("error" in result) {
        errors.push({
          code: result.error,
          line,
          accountNumber,
          column,
          value: String(row[column] ?? "").trim()
        });
      } else {
        amounts[column] = result.amount;
      }
    }
    if (amounts.debit !== undefined && amounts.credit !== undefined) {
      rows.push({
        line,
        accountNumber,
        debit: amounts.debit,
        credit: amounts.credit
      });
    }
  });

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}

/**
 * The CSV's rows on their accounts, by account number. A row with neither a
 * debit nor a credit is dropped. Every number with no account is an error.
 */
export function mapTrialBalanceAccounts(
  rows: TrialBalanceCsvRow[],
  accountIdByNumber: ReadonlyMap<string, string>
):
  | { lines: TrialBalanceCsvLine[]; errors: null }
  | { lines: null; errors: TrialBalanceCsvError[] } {
  const errors: TrialBalanceCsvError[] = [];
  const lines: TrialBalanceCsvLine[] = [];
  for (const row of rows) {
    const accountId = accountIdByNumber.get(row.accountNumber);
    if (!accountId) {
      errors.push({
        code: "unknown-account",
        accountNumber: row.accountNumber
      });
    } else if (row.debit !== 0 || row.credit !== 0) {
      lines.push({ accountId, debit: row.debit, credit: row.credit });
    }
  }
  return errors.length > 0 ? { lines: null, errors } : { lines, errors: null };
}
