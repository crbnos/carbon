// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Papa from "papaparse";

export const CSV_CONTENT_TYPE = "text/csv;charset=utf-8";

/**
 * Strip formula-leading characters (=, +, -, @, tab, CR — optionally behind
 * leading whitespace) from non-numeric strings so a cell can never execute
 * when the CSV is opened in a spreadsheet. Numbers pass through untouched so
 * "-42" stays a negative number. Applied by `encodeCsv` to every string cell;
 * exported for callers that build CSV text by hand.
 */
export function stripCsvFormulaPrefix(value: string): string {
  if (value === "" || !Number.isNaN(Number(value))) {
    return value;
  }
  return value.replace(/^[ \t\r]*[=+\-@\t\r]+/g, "");
}

function sanitizeCell(value: unknown): unknown {
  if (typeof value === "string") return stripCsvFormulaPrefix(value);
  if (value instanceof Date) return value.toISOString();
  // Never ship `[object Object]` or explode a nested object into stray columns.
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export type EncodeCsvOptions = {
  /** Column order and header labels. Defaults to the union of row keys. */
  fields?: string[];
  /** Value emitted for null/undefined cells. Default "". */
  emptyFieldValue?: string;
  /**
   * Emit the header row. Default true. Pass false for every page after the
   * first when streaming one file in pages; the pages join with "\r\n".
   */
  header?: boolean;
};

/**
 * Object rows → CSV text. Injection-safe by construction — every string cell
 * runs through `stripCsvFormulaPrefix`. This is the ONE CSV encoder; the
 * Table export, report exports and import-error downloads all use it.
 */
export function encodeCsv(
  rows: Record<string, unknown>[],
  options: EncodeCsvOptions = {}
): string {
  const fields = options.fields ?? [
    ...new Set(rows.flatMap((row) => Object.keys(row)))
  ];
  const empty = options.emptyFieldValue ?? "";
  const data = rows.map((row) =>
    fields.map((field) => {
      const value = row[field];
      return value == null ? empty : sanitizeCell(value);
    })
  );
  // Headers are cells too — import-error re-exports echo uploaded headers.
  return Papa.unparse(
    { fields: fields.map(stripCsvFormulaPrefix), data },
    { header: options.header ?? true }
  );
}

/** Header row + tabular cells → CSV text (for templates and error re-exports). */
export function encodeCsvTable(fields: string[], data: unknown[][]): string {
  return Papa.unparse({
    fields: fields.map(stripCsvFormulaPrefix),
    data: data.map((row) => row.map(sanitizeCell))
  });
}

export type ParseCsvResult<Row> = {
  rows: Row[];
  /** Header names in file order. */
  fields: string[];
  errors: Papa.ParseError[];
};

/**
 * CSV text → object rows keyed by header. Trims whitespace, skips blank
 * lines. Works in the browser, Node and the edge runtime (papaparse is pure JS).
 */
export function parseCsv<Row extends Record<string, unknown>>(
  text: string
): ParseCsvResult<Row> {
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });
  return {
    rows: result.data ?? [],
    fields: result.meta.fields ?? [],
    errors: result.errors
  };
}

/**
 * Browser File → parsed rows, streaming the file rather than buffering it as
 * a string first. Resolves with the same shape as `parseCsv`.
 */
export function parseCsvFile<Row extends Record<string, unknown>>(
  file: File
): Promise<ParseCsvResult<Row>> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      error: (error) => reject(error),
      complete: (result) =>
        resolve({
          rows: result.data ?? [],
          fields: result.meta.fields ?? [],
          errors: result.errors
        })
    });
  });
}
