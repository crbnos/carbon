// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { encodeCsv } from "@carbon/files/csv";

/**
 * Cell values of the background table export. The on-screen formatters run in
 * the browser only, so a big export holds the plain database values: a date
 * stays `2026-10-13`, an amount stays `1250.5`. One exporter serves every list.
 */

export type ExportColumn = { key: string; label: string };

/** The most rows one export writes. The file holds the first rows above it. */
export const MAX_EXPORT_ROWS = 100_000;

/** The most bytes one export writes (about 200 MB). A wide list can pass this
 *  before `MAX_EXPORT_ROWS`; the file then stops after the page that crossed it. */
export const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

const CUSTOM_FIELD_PREFIX = "customFields->>";

/** The raw value of a column: `row[key]`, or the custom field's value for a
 *  `customFields->>{id}` column (the same key the Table's custom columns use). */
export function readExportValue(
  row: Record<string, unknown>,
  key: string
): unknown {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const customFields = row.customFields;
    if (
      customFields === null ||
      typeof customFields !== "object" ||
      Array.isArray(customFields)
    ) {
      return undefined;
    }
    return (customFields as Record<string, unknown>)[
      key.slice(CUSTOM_FIELD_PREFIX.length)
    ];
  }
  return row[key];
}

/** A raw value as one CSV cell: arrays join with "; ", objects become JSON. */
export function formatExportValue(
  value: unknown
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined)
      .map((item) =>
        typeof item === "object" ? JSON.stringify(item) : String(item)
      )
      .join("; ");
  }
  if (typeof value === "bigint") return value.toString();
  return JSON.stringify(value);
}

/** The header line of the file: the translated labels, in display order,
 *  without a line end (each page starts with its own "\r\n"). */
export function encodeExportHeader(columns: ExportColumn[]): string {
  // With no data rows, papaparse still ends the header with "\r\n".
  return encodeCsv([], {
    fields: columns.map((column) => column.label)
  }).replace(/\r?\n$/, "");
}

/**
 * One page of rows as CSV lines, without a header. Cells are keyed by the
 * column key, not the label, so two columns with the same label stay apart.
 * Returns "" for an empty page.
 */
export function encodeExportRows(
  rows: Record<string, unknown>[],
  columns: ExportColumn[]
): string {
  if (rows.length === 0) return "";
  const cells = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const column of columns) {
      out[column.key] = formatExportValue(readExportValue(row, column.key));
    }
    return out;
  });
  return encodeCsv(cells, {
    fields: columns.map((column) => column.key),
    header: false
  });
}
