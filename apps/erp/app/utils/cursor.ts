// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { quoteFilterValue } from "@carbon/utils";

/**
 * Cursor (keyset) paging for list loaders.
 *
 * A cursor is the last row of a page: the value of each sort column plus the
 * row's unique id. The next page is "every row that sorts after it", which the
 * database answers from an index at any depth, and which stays stable when
 * rows are added or deleted between two requests.
 *
 * Postgres orders NULLs last when ascending and first when descending (the
 * default, which `.order(column, { ascending })` keeps), so the "after" filter
 * follows the same rule.
 */

export type CursorValue = string | number | boolean | null | string[];

/**
 * The last row of a page. `keys` names the sorts the values were read for
 * (`keysetKeys`), so a cursor cut for another order is never compared with
 * this one.
 */
export type Cursor = { values: CursorValue[]; id: string; keys: string[] };

export type KeysetSort = { column: string; ascending: boolean };

/** A sort the user picked (`?sort=column:asc`). */
export type Sort = {
  sortBy: string;
  sortAsc: boolean;
};

export type DefaultSort = {
  column: string;
  ascending: boolean;
  foreignTable?: string;
};

/**
 * How a list orders its rows when the user picks no sort, and the unique
 * column that breaks ties. One `X_PAGING` constant per list: the service
 * passes it to `setGenericQueryFilters`, the loader to `toPage`, and the
 * registry entry spreads it.
 */
export type Paging = {
  defaultSorts: DefaultSort[];
  /** The unique column that breaks ties. Default: `id`. */
  idColumn?: string;
};

const CUSTOM_FIELD_PREFIX = "customFields->>";

const logger = getLogger("erp", "cursor");

/**
 * The list's order: the user's sorts when present, else the defaults. A sort
 * on another table's column (`table.column`) is dropped: the keyset filter
 * cannot compare it. A default sort on a `foreignTable` orders the embedded
 * rows, not the list, so it is applied but stays out of the keyset.
 */
export function resolveSorts(
  sorts: Sort[] | undefined,
  defaultSorts: DefaultSort[] = []
): { orders: DefaultSort[]; keyset: KeysetSort[] } {
  const userSorts = (sorts ?? [])
    .filter((sort) => !sort.sortBy.includes("."))
    .map((sort) => ({ column: sort.sortBy, ascending: sort.sortAsc }));

  const orders = userSorts.length > 0 ? userSorts : defaultSorts;
  const keyset = orders
    .filter((sort) => !("foreignTable" in sort && sort.foreignTable))
    .map(({ column, ascending }) => ({ column, ascending }));

  return { orders, keyset };
}

/** The signature of an order, stored in the cursor: `["createdAt:desc"]`. */
export function keysetKeys(sorts: KeysetSort[]): string[] {
  return sorts.map(
    (sort) => `${sort.column}:${sort.ascending ? "asc" : "desc"}`
  );
}

/** Whether `cursor` was cut for the order `sorts`. */
export function cursorMatchesSorts(cursor: Cursor, sorts: KeysetSort[]) {
  const keys = keysetKeys(sorts);
  return (
    cursor.values.length === keys.length &&
    cursor.keys.length === keys.length &&
    cursor.keys.every((key, index) => key === keys[index])
  );
}

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(token: string): unknown {
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/** Returns null for a missing, malformed or tampered token. */
export function decodeCursor(token: string | null): Cursor | null {
  if (!token) return null;
  try {
    const parsed = fromBase64Url(token);
    return isCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The `?after=` token of a list that pages by offset (an RPC with no
 * keyset: printing jobs, the audit log). It is not a `Cursor`.
 */
export function encodeOffsetToken(offset: number): string {
  return toBase64Url(JSON.stringify({ offset }));
}

/** The offset in an offset token; 0 for a missing or malformed token. */
export function decodeOffsetToken(token: string | null): number {
  if (!token) return 0;
  try {
    const parsed = fromBase64Url(token) as { offset?: unknown } | null;
    const offset = parsed?.offset;
    return typeof offset === "number" && Number.isInteger(offset) && offset > 0
      ? offset
      : 0;
  } catch {
    return 0;
  }
}

function isCursorValue(value: unknown): value is CursorValue {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every((v) => typeof v === "string");
  return ["string", "number", "boolean"].includes(typeof value);
}

function isCursor(value: unknown): value is Cursor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    Array.isArray(candidate.values) &&
    candidate.values.every(isCursorValue) &&
    Array.isArray(candidate.keys) &&
    candidate.keys.every((key) => typeof key === "string")
  );
}

// An array value is a Postgres array literal, itself quoted.
function quote(value: Exclude<CursorValue, null>) {
  if (Array.isArray(value)) {
    return quoteFilterValue(`{${value.map(quoteFilterValue).join(",")}}`);
  }
  return quoteFilterValue(String(value));
}

function equalTerm(column: string, value: CursorValue) {
  return value === null ? `${column}.is.null` : `${column}.eq.${quote(value)}`;
}

// The terms that put a row strictly after `value` on one sort column. Each
// term becomes its own branch; an empty list means no row is strictly after.
function afterTerms(sort: KeysetSort, value: CursorValue): string[] {
  const { column, ascending } = sort;
  if (ascending) {
    // NULLS LAST: after a value come the larger values, then the NULLs.
    return value === null
      ? []
      : [`${column}.gt.${quote(value)}`, `${column}.is.null`];
  }
  // NULLS FIRST: after a NULL come all the values; after a value, the smaller ones.
  return value === null
    ? [`${column}.not.is.null`]
    : [`${column}.lt.${quote(value)}`];
}

function branch(terms: string[]) {
  return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
}

/**
 * The argument for `query.or(...)` that keeps only the rows after `cursor` in
 * the order `sorts` + `idColumn` ascending.
 */
export function buildKeysetFilter(
  sorts: KeysetSort[],
  cursor: Pick<Cursor, "values" | "id">,
  idColumn: string
): string {
  const branches: string[] = [];
  const prefix: string[] = [];

  sorts.forEach((sort, index) => {
    const value = cursor.values[index] ?? null;
    for (const term of afterTerms(sort, value)) {
      branches.push(branch([...prefix, term]));
    }
    prefix.push(equalTerm(sort.column, value));
  });

  // The id is unique, so it decides between rows that tie on every sort. When
  // the last sort is the id itself, the order is already total.
  if (sorts[sorts.length - 1]?.column !== idColumn) {
    branches.push(branch([...prefix, `${idColumn}.gt.${quote(cursor.id)}`]));
  }

  return branches.join(",");
}

function toCursorValue(value: unknown): CursorValue {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "object") return JSON.stringify(value);
  return value as CursorValue;
}

export function readSortValue(
  row: Record<string, unknown>,
  column: string
): CursorValue {
  if (column.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = column.slice(CUSTOM_FIELD_PREFIX.length);
    const customFields = row.customFields as
      | Record<string, unknown>
      | null
      | undefined;
    const value = customFields?.[key];
    // `->>` reads JSON as text, so the cursor compares it as text too.
    return value === undefined || value === null ? null : String(value);
  }
  return toCursorValue(row[column]);
}

function missingColumn(row: Record<string, unknown>, columns: string[]) {
  return columns.find(
    (column) => !column.startsWith(CUSTOM_FIELD_PREFIX) && !(column in row)
  );
}

type PageArgs = { limit: number; sorts: KeysetSort[]; idColumn?: string };

/**
 * Turns `limit + 1` fetched rows into one page. The extra row only proves that
 * a next page exists; the cursor comes from the last row the page keeps.
 *
 * Two forms:
 * - `toPage(rows, { limit, sorts, idColumn })` with the sorts the query
 *   ordered by (`getEffectiveSorts`).
 * - `toPage(rows, { limit, sorts }, X_PAGING)` with the user's sorts (from
 *   `getGenericQueryFilters`) and the list's paging: it resolves the order
 *   the same way `setGenericQueryFilters` does.
 *
 * If a sort column or the id column is not in the row (the service's select
 * lacks it), the page ends the list (`nextCursor: null`) and a warning is
 * logged: a cursor without the value would repeat or skip rows.
 */
export function toPage<T extends Record<string, unknown>>(
  rows: T[],
  args: PageArgs
): { rows: T[]; nextCursor: string | null };
export function toPage<T extends Record<string, unknown>>(
  rows: T[],
  args: { limit: number; sorts?: Sort[] },
  paging: Paging
): { rows: T[]; nextCursor: string | null };
export function toPage<T extends Record<string, unknown>>(
  rows: T[],
  args: PageArgs | { limit: number; sorts?: Sort[] },
  paging?: Paging
): { rows: T[]; nextCursor: string | null } {
  const { limit } = args;
  const sorts = paging
    ? resolveSorts(args.sorts as Sort[] | undefined, paging.defaultSorts).keyset
    : (args as PageArgs).sorts;
  const idColumn = (paging ?? (args as PageArgs)).idColumn ?? "id";

  if (rows.length <= limit) {
    return { rows, nextCursor: null };
  }

  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  const missing = missingColumn(last, [
    ...sorts.map((sort) => sort.column),
    idColumn
  ]);
  if (missing) {
    logger.warning(
      "Cursor paging stopped: the column {column} is not in the list's select",
      { column: missing }
    );
    return { rows: kept, nextCursor: null };
  }

  return {
    rows: kept,
    nextCursor: encodeCursor({
      values: sorts.map((sort) => readSortValue(last, sort.column)),
      id: String(last[idColumn]),
      keys: keysetKeys(sorts)
    })
  };
}
