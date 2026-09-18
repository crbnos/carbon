/**
 * Encodes a value for a `json` / `jsonb` column written through Kysely on the
 * deno-postgres driver.
 *
 * deno-postgres (`query/encode.ts`) serialises query parameters by JS type, not
 * by column type: an object becomes `JSON.stringify(value)`, but a string is
 * sent as raw text and an array as a Postgres array literal (`{a,b}`). For a
 * JSON column that means a stored JSON string scalar (`"some text"`) is read
 * back by supabase-js as the JS string `some text`, re-sent unquoted, and
 * rejected with `invalid input syntax for type json`; a JSON array is mangled
 * the same way. Only object-shaped values survive the round trip.
 *
 * Pre-serialising here makes the wire value valid JSON text for every shape,
 * so a row copied from one document to another (quote → sales order, RFQ →
 * quote, …) keeps working whatever a previous writer stored. `null` and
 * `undefined` pass through so the column's NULL / DEFAULT semantics are kept.
 */
export function toJson(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value;
  return JSON.stringify(value);
}

/**
 * Runs `toJson` over a fixed list of jsonb columns on a row read back from
 * Supabase, for re-inserting that row (or a spread of it) through Kysely —
 * e.g. `{ ...line, ...toJsonColumns(line, QUOTE_LINE_JSON_COLUMNS) }`.
 *
 * A document-copy that spreads a source row raw (`{...line, quoteId, companyId}`)
 * silently regresses to the unserialised bug the day a new jsonb column is
 * added to that table and the spread picks it up untouched. Naming the
 * column list here, next to the call site, makes that list something a
 * future column addition has to be checked against, and something a test can
 * assert against directly.
 */
export function toJsonColumns<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  keys: readonly K[]
): { [P in K]: string | null | undefined } {
  const out = {} as { [P in K]: string | null | undefined };
  for (const key of keys) {
    out[key] = toJson(row[key]);
  }
  return out;
}
