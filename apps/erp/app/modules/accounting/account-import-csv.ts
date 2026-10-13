// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import as a CSV: the customer's chart, one row per
// account, each naming the Carbon account it replaces. Pure: the route plans
// and applies the rows (.ai/specs/2026-10-12-chart-of-accounts-import.md).

import {
  ACCOUNT_CLASSES,
  type AccountImportRow
} from "@carbon/database/account-import";
import { parseCsv } from "@carbon/files/csv";

/** The columns of the template, by header name, in order. */
export const ACCOUNT_IMPORT_CSV_COLUMNS = [
  "Number",
  "Name",
  "Class",
  "Type",
  "Group",
  "Carbon Account",
  "Used For"
] as const;

/** The columns an upload must have. `Type` and `Used For` may be left out. */
const REQUIRED_COLUMNS = [
  "Number",
  "Name",
  "Class",
  "Group",
  "Carbon Account"
] as const;

/** Why a CSV was not read. `line` is the line in the file; the header is 1. */
export type AccountImportCsvError =
  | { code: "empty-file" }
  | { code: "missing-columns"; columns: string[] }
  | { code: "missing-number"; line: number }
  | { code: "missing-name"; line: number }
  | { code: "missing-group"; line: number }
  | { code: "invalid-class"; line: number; value: string };

const text = (value: unknown) => String(value ?? "").trim();

export function parseAccountImportCsv(
  csv: string
):
  | { rows: AccountImportRow[]; errors: null }
  | { rows: null; errors: AccountImportCsvError[] } {
  if (csv.trim() === "")
    return { rows: null, errors: [{ code: "empty-file" }] };
  const parsed = parseCsv<Record<string, unknown>>(csv);
  const missing = REQUIRED_COLUMNS.filter(
    (column) => !parsed.fields.includes(column)
  );
  if (missing.length > 0) {
    return {
      rows: null,
      errors: [{ code: "missing-columns", columns: missing }]
    };
  }
  if (parsed.rows.length === 0) {
    return { rows: null, errors: [{ code: "empty-file" }] };
  }

  const classes: readonly string[] = ACCOUNT_CLASSES;
  const errors: AccountImportCsvError[] = [];
  const rows: AccountImportRow[] = [];
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const number = text(row.Number);
    const name = text(row.Name);
    const group = text(row.Group);
    const accountClass = text(row.Class);
    if (!number) errors.push({ code: "missing-number", line });
    if (!name) errors.push({ code: "missing-name", line });
    if (!group) errors.push({ code: "missing-group", line });
    const matchedClass = classes.find(
      (c) => c.toLowerCase() === accountClass.toLowerCase()
    );
    if (accountClass && !matchedClass) {
      errors.push({ code: "invalid-class", line, value: accountClass });
    }
    if (!number || !name || !group) return;
    rows.push({
      line,
      number,
      name,
      class: (matchedClass as AccountImportRow["class"]) ?? null,
      accountType: text(row.Type) || null,
      group,
      carbonAccounts: text(row["Carbon Account"])
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part !== "")
    });
  });

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}
