// call_tool result formatting for the MCP surface ONLY — the HTTP API, the
// in-app agent, and the workflow dispatcher consume callOperation's structured
// data untouched. Everything here trades bytes for nothing an agent needs:
// compact JSON (indentation roughly doubles whitespace tokens on row arrays),
// null-stripped rows (an ERP row is ~half null columns), and a hard row cap as
// a backstop for the unpaginated `get*List` operations that ignore `limit`.

/** Injected into list-operation args when the caller passes no `limit`. */
export const MCP_DEFAULT_LIMIT = 25;

/** Backstop cap on serialized rows, for operations that cannot page. */
export const MCP_MAX_ROWS = 100;

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
 * Serialize a call_tool result for the MCP text response. `count` is the
 * operation's total-row count when the read was paginated — surfaced so an
 * agent pages deliberately instead of assuming it saw everything.
 */
export function formatMcpResult(data: unknown, count?: number): string {
  let rows = data;
  let omitted = 0;
  if (Array.isArray(data) && data.length > MCP_MAX_ROWS) {
    rows = data.slice(0, MCP_MAX_ROWS);
    omitted = data.length - MCP_MAX_ROWS;
  }

  let text = JSON.stringify(stripNulls(rows));
  if (omitted > 0) {
    text += `\n… ${omitted} more rows omitted — pass limit/offset to page, or use a more specific tool`;
  }
  if (typeof count === "number" && Array.isArray(data) && count > data.length) {
    text += `\n(showing ${Array.isArray(rows) ? rows.length : data.length} of ${count} rows)`;
  }
  return text;
}
