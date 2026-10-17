// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { encodeCsv } from "@carbon/files/csv";

// call_tool result formatting for the MCP surface ONLY — the HTTP API, the
// in-app agent, and the workflow dispatcher consume callOperation's structured
// data untouched. Everything here trades bytes for nothing an agent needs:
// compact JSON (indentation roughly doubles whitespace tokens on row arrays),
// null-stripped rows (an ERP row is ~half null columns), optional field
// projection, and a row and character budget so one wide page cannot flood the context.

/** Injected into list-operation args when the caller passes no `limit`. */
export const MCP_DEFAULT_LIMIT = 25;

/** Most rows one call returns; a larger `limit` is clamped to it. */
export const MCP_MAX_ROWS = 100;

/** Most characters of rows one call returns (~5k tokens). */
export const MCP_MAX_CHARS = 20_000;

/**
 * Drop null/undefined OBJECT ENTRIES recursively. Array elements are kept
 * positionally (a null element may be meaningful; a null field is just an
 * unset column). Documented to agents in the server instructions: an absent
 * field reads as null.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      out[key] = stripNulls(entry);
    }
    return out;
  }
  return value;
}

/**
 * Page a fetchAll list result at the MCP boundary. The `get*List` services
 * ignore limit/offset entirely (`paginates: false` in the manifest), so the
 * caller's paging is applied to the full result here — the slice plus the
 * original total, which `formatMcpResult` reports as "(showing R of C rows)".
 */
export function pageMcpListResult(
  data: unknown,
  { limit, offset }: { limit: number; offset: number }
): { rows: unknown; total?: number } {
  if (!Array.isArray(data)) return { rows: data };
  return { rows: data.slice(offset, offset + limit), total: data.length };
}

/**
 * Keep only the named top-level fields of each row (or of a single object).
 * Wide ERP rows carry 50+ columns; an agent that needs three of them should not
 * pay for the rest.
 */
export function projectFields(data: unknown, fields?: string[]): unknown {
  if (!fields?.length) return data;
  const pick = (row: unknown) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in row) out[field] = (row as Record<string, unknown>)[field];
    }
    return out;
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
}

export type McpResultOptions = {
  /** The operation's total when the read was paginated. */
  count?: number;
  /** Where this page starts. */
  offset?: number;
  /** The operation's name, for the CSV header. */
  name?: string;
  /** `false` lifts the row cap and the character budget. */
  truncate?: boolean;
};

/**
 * Serialize a call_tool result for the MCP text response.
 *
 * A list of records is CSV, written by `encodeCsv` (`@carbon/files/csv`): the
 * column names once, then one line per record, about 70% smaller than a JSON
 * array that repeats every key on every row. An empty cell is null or an empty
 * string, and a nested value is JSON inside its cell. Columns that are empty in
 * every row shown are left out. String cells are kept as they are
 * (`formulaSafe: false`): the reader is an agent, not a spreadsheet. Anything
 * else (one record, a list of plain values) is compact JSON with nulls removed.
 *
 * A list is cut at `MCP_MAX_ROWS` rows or `MCP_MAX_CHARS` characters,
 * whichever comes first, unless `truncate` is false, and a list short of its
 * total ends with the offset of the next page, so an agent pages deliberately
 * instead of assuming it saw everything.
 */
export function formatMcpResult(
  data: unknown,
  { count, offset = 0, name, truncate = true }: McpResultOptions = {}
): string {
  if (!Array.isArray(data) || data.length === 0 || !data.every(isRecord)) {
    return formatJson(data, count, offset, truncate);
  }

  const rows = data.map(csvRow);
  const title = `# ${name ?? "results"}.csv`;
  const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  // Pick the rows that fit, sized with every column; the final encode keeps
  // only the columns the shown rows use, which can only make it shorter.
  let shown = 0;
  let length =
    title.length +
    1 +
    encodeCsv([], { fields: allColumns, formulaSafe: false }).length;
  for (const row of rows) {
    if (truncate && shown === MCP_MAX_ROWS) break;
    const line = encodeCsv([row], {
      fields: allColumns,
      header: false,
      formulaSafe: false
    });
    // Always emit one row: a single row over budget still answers the call.
    if (truncate && shown > 0 && length + line.length + 2 > MCP_MAX_CHARS) {
      break;
    }
    shown++;
    length += line.length + 2;
  }

  return (
    `${title}\r\n${encodeCsv(rows.slice(0, shown), { formulaSafe: false })}` +
    pageFooter(shown, data.length, count, offset)
  );
}

/** A record with nulls removed and arrays as JSON, which `encodeCsv` would
 *  otherwise write comma-joined. */
function csvRow(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stripNulls(record) as Record<string, unknown>).map(
      ([key, value]) => [
        key,
        Array.isArray(value) ? JSON.stringify(value) : value
      ]
    )
  );
}

function formatJson(
  data: unknown,
  count: number | undefined,
  offset: number,
  truncate: boolean
): string {
  if (!Array.isArray(data)) return JSON.stringify(stripNulls(data)) ?? "";
  const serialized: string[] = [];
  let length = 2;
  for (const value of data) {
    if (truncate && serialized.length === MCP_MAX_ROWS) break;
    const text = JSON.stringify(stripNulls(value)) ?? "null";
    if (
      truncate &&
      serialized.length > 0 &&
      length + text.length + 1 > MCP_MAX_CHARS
    ) {
      break;
    }
    serialized.push(text);
    length += text.length + 1;
  }
  return (
    `[${serialized.join(",")}]` +
    pageFooter(serialized.length, data.length, count, offset)
  );
}

/** "(rows A-B of TOTAL; next page: offset N)", when the page is short of its total. */
function pageFooter(
  shown: number,
  received: number,
  count: number | undefined,
  offset: number
): string {
  const total = typeof count === "number" ? count : offset + received;
  const next = offset + shown;
  if (next >= total) return "";
  let footer = `\n(rows ${shown ? `${offset + 1}-${next}` : "none"} of ${total}; next page: offset ${next}`;
  if (shown < received) {
    footer += `, output capped at ${MCP_MAX_CHARS} characters, pass \`fields\` to return only the columns you need, or \`truncate: false\` for the whole page`;
  }
  return `${footer})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
