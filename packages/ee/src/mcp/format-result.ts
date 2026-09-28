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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Apply the MCP list default to a list operation's call_tool arguments.
 *
 * - Paginating service (`paginates`): fill the PAIR — `.range()` applies only
 *   when both limit and offset are integers. Returns the args to dispatch.
 * - fetchAll service: limit/offset are inert in the service, so the caller's
 *   paging is returned for the response to be sliced (`pageMcpListResult`).
 *
 * With a legacy envelope beside flat siblings (`{ jobId, limit, args: {…} }`),
 * the envelope is spread over the siblings downstream, so a flat limit/offset
 * is carried into the envelope rather than overridden by the default.
 * Mutates `args` in place when it is an object.
 */
export function fillMcpListPaging(
  args: unknown,
  paginates: boolean | undefined
): { args: unknown; paging: { limit: number; offset: number } | null } {
  const body = isPlainObject(args) ? args : null;
  const wrapped = body && isPlainObject(body.args) ? body.args : null;
  if (paginates) {
    // The argless call is the worst offender — no limit at all.
    if (!body)
      return { args: { limit: MCP_DEFAULT_LIMIT, offset: 0 }, paging: null };
    const target = wrapped ?? body;
    const flat = wrapped ? body : undefined;
    if (target.limit === undefined)
      target.limit = flat?.limit ?? MCP_DEFAULT_LIMIT;
    if (target.offset === undefined) target.offset = flat?.offset ?? 0;
    return { args, paging: null };
  }
  const limit = wrapped?.limit ?? body?.limit;
  const offset = wrapped?.offset ?? body?.offset;
  return {
    args,
    paging: {
      limit:
        Number.isInteger(limit) && (limit as number) > 0
          ? (limit as number)
          : MCP_DEFAULT_LIMIT,
      offset:
        Number.isInteger(offset) && (offset as number) >= 0
          ? (offset as number)
          : 0
    }
  };
}

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
