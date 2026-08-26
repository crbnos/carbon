import type { ReportPeriodBucket } from "@carbon/utils";
import type { Chart, ChartPeriodSeries } from "../../types";
import { computeExecutivePnl, type ExecutivePnlRowKey } from "./executivePnl";
import {
  accountsToFlatTree,
  filterAccounts,
  getDebitCredit
} from "./reportTree";

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  const safeText =
    typeof value === "string" &&
    !Number.isFinite(Number(value)) &&
    /^[=+\-@]/.test(text)
      ? `'${text}`
      : text;
  return /[",\r\n]/.test(safeText)
    ? `"${safeText.replaceAll('"', '""')}"`
    : safeText;
}

export function serializeCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvCell(row[header])).join(",")
    )
  ].join("\r\n");
}

export function serializeCsvRows(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

// Standalone CSV download (ExchangeRateForm pattern) — the report trees are
// not built on the shared Table component, so they get no free export button.
function downloadCsvData(csvData: string, filename: string) {
  if (!csvData) return;
  const blob = new Blob([csvData], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  downloadCsvData(serializeCsv(rows), filename);
}

export function downloadCsvRows(rows: string[][], filename: string) {
  downloadCsvData(serializeCsvRows(rows), filename);
}

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

// Export the single-period trial balance with the same Beginning/Debit/Credit/
// Ending derivation the tree renders.
export function exportTrialBalance(args: {
  accounts: (Chart & { translatedBalance?: number })[];
  showTranslated?: boolean;
  parentCurrency?: string | null;
  search: string;
  filename: string;
}) {
  const tree = accountsToFlatTree(filterAccounts(args.accounts, args.search));
  const rows = tree.map(({ data: account }) => {
    const endingBalance = account.balanceAtDate ?? 0;
    const netChange = account.netChange ?? 0;
    const { debit, credit } = getDebitCredit(netChange, account.class);
    const row: Record<string, unknown> = {
      Number: account.isGroup ? "" : (account.number ?? ""),
      Account: account.name ?? "",
      Beginning: endingBalance - netChange,
      Debits: debit,
      Credits: credit,
      Ending: endingBalance
    };
    if (args.showTranslated) {
      row[`Ending (${args.parentCurrency ?? "Translated"})`] =
        account.translatedBalance ?? "";
    }
    return row;
  });
  downloadCsv(rows, args.filename);
}
