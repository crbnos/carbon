// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The import report as an agent reads it over MCP (importCsvText). Kept out of
// shared.service.ts so the MCP manifest's inputs stay the service functions.

type RowIssue = {
  row: number;
  reason: string;
  values?: Record<string, string>;
};

// The importer's reasons for a required value that is empty: "Missing
// required Part Number", "Name is required", "Op 10: Process is required",
// "Invalid contact (missing required fields)".
const MISSING_VALUE = /missing required|\b(is|are) required$/i;

/** The importer's report, as the import-csv server function returns it. */
type ImportReport = {
  success: boolean;
  dryRun?: boolean;
  inserted: number;
  updated: number;
  errors: RowIssue[];
  skipped: RowIssue[];
};

/** The report an agent reads: the refused rows split by what fixes them. */
export type AgentImportReport = {
  success: boolean;
  dryRun?: boolean;
  inserted: number;
  updated: number;
  skipped: RowIssue[];
  /** A required value is empty: the user has to supply it. */
  missing: RowIssue[];
  /** A value matches no option or record, or has the wrong form. */
  mismatched: RowIssue[];
};

/**
 * Splits the rows an import refused into `missing` and `mismatched`. Skipped
 * rows and the counts are passed through.
 */
export function splitRefusedRows({
  errors,
  ...report
}: ImportReport): AgentImportReport {
  return {
    ...report,
    missing: errors.filter((issue) => MISSING_VALUE.test(issue.reason)),
    mismatched: errors.filter((issue) => !MISSING_VALUE.test(issue.reason))
  };
}
