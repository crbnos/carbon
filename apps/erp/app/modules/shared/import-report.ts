// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The import report as an agent reads it over MCP (importCsvText). Kept out of
// shared.service.ts so the MCP manifest's inputs stay the service functions.

import {
  enumDefault,
  fieldMappings,
  methodRowTypeFields
} from "./imports.models";
import type { CsvImportTable } from "./shared.models";

type FieldDefinition = {
  label: string;
  type: string;
  default?: string | number | boolean;
  enumData?: { options?: readonly string[]; default?: string };
};

type RowIssue = {
  row: number;
  reason: string;
  values?: Record<string, string>;
};

/** The importer's report, as the import-csv server function returns it. */
type ImportReport = {
  success: boolean;
  dryRun?: boolean;
  inserted: number;
  updated: number;
  errors: RowIssue[];
  skipped: RowIssue[];
  existingRows?: number[];
};

/** A value Carbon fills on new records whose cell for the field is empty. */
export type ImportDefault = {
  field: string;
  label: string;
  value: string;
  /** Rows of the file that take it. */
  rows: number;
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
  /** The defaults new records take, for the user to confirm or change. */
  defaults: ImportDefault[];
};

// The importer's reasons for a required value that is empty: "Missing
// required Part Number", "Name is required", "Op 10: Process is required",
// "Invalid contact (missing required fields)".
const MISSING_VALUE = /missing required|\b(is|are) required$/i;

// Revisions that name an existing record rather than set one: a blank one
// means revision 0 of the item referred to.
const REFERENCE_FIELDS = new Set([
  "parentRevision",
  "componentRevision",
  "toolRevision"
]);
// Tables whose rows are items, where a blank Revision gives the new item
// revision 0. Elsewhere Revision names the item a row refers to.
const ITEM_TABLES = new Set<CsvImportTable>([
  "part",
  "tool",
  "fixture",
  "consumable",
  "material",
  "service",
  "partWithMethod"
]);
const METHOD_TABLES = new Set<CsvImportTable>([
  "bom",
  "operations",
  "partWithMethod"
]);

/**
 * The defaults a file's new records take: per field and value, how many rows
 * leave the field's cell empty or its column out. A row that updates an
 * existing record keeps its saved values and is not counted, nor is a skipped
 * row; a refused row is, since it takes the same defaults once fixed. In a
 * method file a row counts only for its own row type's fields. An enum's
 * default is the one the import used (`enumMappings`).
 */
export function defaultsForNewRows(args: {
  table: CsvImportTable;
  rows: Record<string, string>[];
  columnMappings: Record<string, string>;
  enumMappings: Record<string, Record<string, string>>;
  excludedRows: number[];
}): ImportDefault[] {
  const { table, rows, columnMappings, enumMappings } = args;
  const fields = Object.entries(
    fieldMappings[table] as Record<string, FieldDefinition>
  ).flatMap(([key, field]) => {
    if (REFERENCE_FIELDS.has(key)) return [];
    if (key === "revision" && !ITEM_TABLES.has(table)) return [];
    const value =
      field.type === "enum"
        ? (enumMappings[key]?.Default ?? enumDefault(field.enumData))
        : field.default !== undefined
          ? String(field.default)
          : undefined;
    return value ? [{ key, label: field.label, value }] : [];
  });

  const excluded = new Set(args.excludedRows);
  const counts = new Map<string, ImportDefault>();
  for (const [rowIndex, row] of rows.entries()) {
    if (excluded.has(rowIndex)) continue;
    const ownFields = METHOD_TABLES.has(table)
      ? methodRowFields(table, row, columnMappings)
      : undefined;
    for (const field of fields) {
      if (ownFields && !ownFields.has(field.key)) continue;
      const column = columnMappings[field.key];
      if (column && (row[column] ?? "").trim() !== "") continue;
      const id = `${field.key}\u0000${field.value}`;
      const entry = counts.get(id) ?? {
        field: field.key,
        label: field.label,
        value: field.value,
        rows: 0
      };
      entry.rows += 1;
      counts.set(id, entry);
    }
  }
  return [...counts.values()];
}

function methodRowFields(
  table: CsvImportTable,
  row: Record<string, string>,
  columnMappings: Record<string, string>
): ReadonlySet<string> {
  const column = columnMappings.rowType;
  const rowType = (column ? (row[column] ?? "") : "").trim().toUpperCase();
  const fields =
    methodRowTypeFields[
      (rowType ||
        (table === "bom" ? "BOM" : "")) as keyof typeof methodRowTypeFields
    ];
  return new Set(fields ?? []);
}

/**
 * Splits the rows an import refused into `missing` and `mismatched`, and
 * adds the defaults new records take. Skipped rows and the counts are passed
 * through.
 */
export function splitRefusedRows(
  { errors, existingRows: _existingRows, ...report }: ImportReport,
  defaults: ImportDefault[] = []
): AgentImportReport {
  return {
    ...report,
    missing: errors.filter((issue) => MISSING_VALUE.test(issue.reason)),
    mismatched: errors.filter((issue) => !MISSING_VALUE.test(issue.reason)),
    defaults
  };
}
