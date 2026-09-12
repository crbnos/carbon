/**
 * SuiteQL over REST has NO bind parameters — `SuiteQL.params` exists only in
 * SuiteScript's `N/query` module. Every literal is interpolated, so escaping is
 * this migration's responsibility rather than the driver's.
 *
 * Nothing here takes free text from an end user today; these helpers exist so
 * that stays true when someone adds a filter later.
 */

/** A single-quoted SQL literal with embedded quotes doubled. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A NetSuite internal id as a SQL literal.
 *
 * Internal ids are always integers. Anything else is refused rather than
 * escaped: a non-numeric id means a caller bug, and quietly quoting it would
 * produce a query that returns nothing and looks like an empty account.
 */
export function sqlId(value: string | number): string {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`"${text}" is not a NetSuite internal id`);
  }
  return text;
}

/** `AND x IN (1, 2, 3)`, or an empty string when there is nothing to filter on. */
export function sqlIdList(values: (string | number)[]): string {
  if (values.length === 0) return "";
  return values.map(sqlId).join(", ");
}

/**
 * The keyset predicate for a paginated query: `1 = 1` on the first page, then
 * `<column> > <lastId>`.
 *
 * Written as a predicate rather than injected into the WHERE clause by string
 * surgery so a query always has valid syntax in both states.
 */
export function keysetPredicate(
  column: string,
  afterId: string | null
): string {
  if (afterId === null) return "1 = 1";
  return `${column} > ${sqlId(afterId)}`;
}
