// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { downloadCsv } from "@carbon/files/csv";
import type { ReportPeriodBucket } from "@carbon/utils";
import {
  getTrialBalanceRows,
  getTrialBalanceTotals,
  hasYearEndClose,
  type TrialBalanceAccount,
  type TrialBalanceRow
} from "../../trial-balance";
import type { ChartPeriodSeries } from "../../types";
import { computeExecutivePnl, type ExecutivePnlRowKey } from "./executivePnl";
import { accountsToFlatTree, filterAccounts } from "./reportTree";

// Export the multi-period statement in flat-tree display order (the FULL tree,
// honoring the current search filter — never the virtualizer's window).
export function exportPeriodReport(args: {
  accounts: ChartPeriodSeries[];
  periods: Array<ReportPeriodBucket & { label: string }>;
  measure: "balanceAtDate" | "netChange";
  showTranslated?: boolean;
  search: string;
  filename: string;
}) {
  const tree = accountsToFlatTree(filterAccounts(args.accounts, args.search));
  const rows = tree.map(({ data: account }) => {
    const row: Record<string, unknown> = {
      Number: account.isGroup ? "" : (account.number ?? ""),
      Account: account.name ?? ""
    };
    for (const bucket of args.periods) {
      const cell = account.periods?.[bucket.key];
      row[bucket.label] = args.showTranslated
        ? (cell?.translatedBalance ?? "")
        : (cell?.[args.measure] ?? 0);
    }
    return row;
  });
  downloadCsv(rows, args.filename);
}

// Export the executive P&L summary rows (condensed subtotals with margins),
// one column per period bucket — mirrors what ExecutivePnlSummary renders.
export function exportExecutivePnl(args: {
  accounts: ChartPeriodSeries[];
  periods: Array<ReportPeriodBucket & { label: string }>;
  labels: Record<ExecutivePnlRowKey, string>;
  showTranslated?: boolean;
  filename: string;
}) {
  const rows = computeExecutivePnl(
    args.accounts,
    args.periods.map((bucket) => bucket.key),
    { showTranslated: args.showTranslated }
  );

  const csvRows = rows.map((row) => {
    const csvRow: Record<string, unknown> = { Line: args.labels[row.key] };
    for (const bucket of args.periods) {
      csvRow[bucket.label] = row.values[bucket.key] ?? 0;
      if (row.margins != null) {
        const margin = row.margins[bucket.key];
        csvRow[`${bucket.label} %`] = margin == null ? "" : margin;
      }
    }
    return csvRow;
  });
  downloadCsv(csvRows, args.filename);
}

// Export the trial balance as it renders: posting accounts only, balances
// debit-signed (a credit is negative), Year-End Close only when the range
// crosses a fiscal year end, and a Total row whose Beginning and Ending are
// zero.
export function exportTrialBalance(args: {
  accounts: TrialBalanceAccount[];
  showTranslated?: boolean;
  parentCurrency?: string | null;
  search: string;
  filename: string;
}) {
  const rows = getTrialBalanceRows(args.accounts, args.search);
  const showClose = hasYearEndClose(getTrialBalanceRows(args.accounts, ""));
  const translatedHeader = `Ending (${args.parentCurrency ?? "Translated"})`;
  const toCsvRow = (
    number: string,
    name: string,
    values: Omit<TrialBalanceRow, "id" | "number" | "name">
  ) => {
    const row: Record<string, unknown> = {
      Number: number,
      Account: name,
      Beginning: values.beginning,
      Debits: values.debits,
      Credits: values.credits,
      ...(showClose ? { "Year-End Close": values.close } : {}),
      Ending: values.ending
    };
    if (args.showTranslated) {
      row[translatedHeader] = values.translatedEnding ?? "";
    }
    return row;
  };
  downloadCsv(
    [
      ...rows.map((row) => toCsvRow(row.number ?? "", row.name ?? "", row)),
      toCsvRow("", "Total", getTrialBalanceTotals(rows))
    ],
    args.filename
  );
}
