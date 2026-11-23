// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { debitSigned, isAccountClass } from "@carbon/database/ledger";
import { round } from "@carbon/utils";

// The account fields a trial balance row is built from. Balances arrive
// natural-signed (positive = the account's normal side), as the balance RPC
// returns them.
export type TrialBalanceAccount = {
  id: string;
  number: string | null;
  name: string | null;
  class: string | null;
  incomeBalance?: string | null;
  isGroup: boolean | null;
  balanceAtDate?: number | null;
  netChange?: number | null;
  translatedBalance?: number | null;
  /** Gross debits in the range, a magnitude. Without them the net change is
   *  shown on its side. */
  debits?: number | null;
  /** Gross credits in the range, a magnitude. */
  credits?: number | null;
};

/**
 * One posting account of the trial balance. Balances are debit-signed — a
 * debit is positive and a credit negative, whatever the account's class — so
 * every column sums the way an accountant reads it: Beginning, Year-End Close
 * and Ending total zero, and Debits equal Credits. `debits` / `credits` are
 * magnitudes; `close` is what moved to Retained Earnings at a fiscal year end
 * inside the range, debit-signed. Each row holds
 * `beginning + debits − credits + close = ending`.
 */
export type TrialBalanceRow = {
  id: string;
  number: string | null;
  name: string | null;
  beginning: number;
  debits: number;
  credits: number;
  close: number;
  ending: number;
  translatedEnding: number | null;
};

export type TrialBalanceTotals = Omit<
  TrialBalanceRow,
  "id" | "number" | "name" | "translatedEnding"
> & { translatedEnding: number | null };

function toDebitSigned(accountClass: string | null, amount: number) {
  return isAccountClass(accountClass)
    ? debitSigned(accountClass, amount)
    : amount;
}

/**
 * Closes the income statement into Retained Earnings at each fiscal year end,
 * as a posted year-end close would, without posting one. Revenue and Expense
 * accounts keep only the activity of the fiscal year that holds the date
 * (Beginning: the year holding the range start; Ending: the year holding the
 * range end), and Retained Earnings takes everything earlier. Balances stay
 * natural-signed, and `netChange` becomes `ending − beginning`, so a range that
 * crosses a fiscal year end carries the close in it.
 *
 * `closedAtStart` / `closedAtEnd` are each account's cumulative natural-signed
 * balance on the day before the fiscal year holding the range start / end
 * begins. With no Retained Earnings account the balances are returned as they
 * are, because the profit would have nowhere to go.
 */
export function closeIncomeStatement<T extends TrialBalanceAccount>(
  accounts: T[],
  args: {
    retainedEarningsAccountId: string | null | undefined;
    closedAtStart: Record<string, number>;
    closedAtEnd: Record<string, number>;
  }
): T[] {
  // The defaults save does not check the class of the account it maps, and a
  // profit closed anywhere but a Balance Sheet equity account would not tie.
  const retainedEarnings = accounts.find(
    (a) =>
      a.id === args.retainedEarningsAccountId &&
      !a.isGroup &&
      a.class === "Equity" &&
      a.incomeBalance !== "Income Statement"
  );
  if (!retainedEarnings) return accounts;

  const isIncomeStatement = (a: T) =>
    !a.isGroup && a.incomeBalance === "Income Statement";

  // Debit-signed income statement total moved to Retained Earnings.
  let closedStart = 0;
  let closedEnd = 0;
  for (const a of accounts) {
    if (!isIncomeStatement(a)) continue;
    closedStart += toDebitSigned(a.class, args.closedAtStart[a.id] ?? 0);
    closedEnd += toDebitSigned(a.class, args.closedAtEnd[a.id] ?? 0);
  }

  return accounts.map((a) => {
    const ending = a.balanceAtDate ?? 0;
    const beginning = ending - (a.netChange ?? 0);
    let rolledEnding: number;
    let rolledBeginning: number;
    if (isIncomeStatement(a)) {
      rolledEnding = ending - (args.closedAtEnd[a.id] ?? 0);
      rolledBeginning = beginning - (args.closedAtStart[a.id] ?? 0);
    } else if (a.id === retainedEarnings.id) {
      rolledEnding = ending + toDebitSigned(a.class, closedEnd);
      rolledBeginning = beginning + toDebitSigned(a.class, closedStart);
    } else {
      return a;
    }
    return {
      ...a,
      balanceAtDate: rolledEnding,
      netChange: rolledEnding - rolledBeginning
    };
  });
}

/**
 * The trial balance: every posting account (never a group — a group's balance
 * is its accounts' balances counted again) in account-number order, filtered
 * by number or name.
 */
export function getTrialBalanceRows(
  accounts: TrialBalanceAccount[],
  search: string
): TrialBalanceRow[] {
  const query = search.trim().toLowerCase();

  return accounts
    .filter((account) => !account.isGroup)
    .filter(
      (account) =>
        !query ||
        account.name?.toLowerCase().includes(query) ||
        account.number?.toLowerCase().includes(query)
    )
    .sort(
      (a, b) =>
        (a.number ?? "").localeCompare(b.number ?? "", undefined, {
          numeric: true
        }) || (a.name ?? "").localeCompare(b.name ?? "")
    )
    .map((account) => {
      const ending = toDebitSigned(account.class, account.balanceAtDate ?? 0);
      const netChange = toDebitSigned(account.class, account.netChange ?? 0);
      const beginning = ending - netChange;
      const hasGross = account.debits != null && account.credits != null;
      const debits = hasGross
        ? (account.debits ?? 0)
        : netChange > 0
          ? netChange
          : 0;
      const credits = hasGross
        ? (account.credits ?? 0)
        : netChange < 0
          ? -netChange
          : 0;
      return {
        id: account.id,
        number: account.number,
        name: account.name,
        beginning,
        debits,
        credits,
        close: round(netChange - (debits - credits)),
        ending,
        translatedEnding:
          account.translatedBalance == null
            ? null
            : toDebitSigned(account.class, account.translatedBalance)
      };
    });
}

/**
 * A row as the account ledger drawer's summary: `netChange` is the movement
 * its lines add up to, and `close` the unposted part no line shows, so
 * `opening + netChange + close = closing`.
 */
export function trialBalanceLedgerSummary(row: TrialBalanceRow) {
  return {
    opening: row.beginning,
    netChange: round(row.debits - row.credits),
    close: row.close,
    closing: row.ending
  };
}

/** Column totals, summed first and rounded once. */
export function getTrialBalanceTotals(
  rows: TrialBalanceRow[]
): TrialBalanceTotals {
  let beginning = 0;
  let debits = 0;
  let credits = 0;
  let close = 0;
  let ending = 0;
  let translatedEnding: number | null = null;
  for (const row of rows) {
    beginning += row.beginning;
    debits += row.debits;
    credits += row.credits;
    close += row.close;
    ending += row.ending;
    if (row.translatedEnding != null) {
      translatedEnding = (translatedEnding ?? 0) + row.translatedEnding;
    }
  }
  return {
    beginning: round(beginning),
    debits: round(debits),
    credits: round(credits),
    close: round(close),
    ending: round(ending),
    translatedEnding: translatedEnding == null ? null : round(translatedEnding)
  };
}

/** The Year-End Close column shows only when the range crosses a fiscal year
 *  end, i.e. some row moved a balance to Retained Earnings. */
export function hasYearEndClose(rows: TrialBalanceRow[]) {
  return rows.some((row) => row.close !== 0);
}
