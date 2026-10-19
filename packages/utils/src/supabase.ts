// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function sanitize<T extends Record<string, any>>(
  input: T
): {
  [K in keyof T]: T[K] extends undefined ? null : T[K];
} {
  const output = { ...input } as {
    [K in keyof T]: T[K] extends undefined ? null : T[K];
  };
  Object.keys(output).forEach((key) => {
    if (output[key as keyof T] === undefined && key !== "id") {
      output[key as keyof T] = null as any;
    }
  });
  return output;
}

/**
 * A PostgREST `.or()` filter matching `term`, as typed, anywhere in any of
 * `columns`. Two layers of escaping: `\`, `%` and `_` for ILIKE, so they
 * match themselves, then the value is quoted for PostgREST, so a comma, dot
 * or parenthesis is text, not filter syntax. Interpolated bare, "a,b" ended
 * the filter early and the request failed.
 */
export function searchFilter(columns: string[], term: string): string {
  const quoted = `"%${escapeLike(term).replace(/["\\]/g, (char) => `\\${char}`)}%"`;
  return columns.map((column) => `${column}.ilike.${quoted}`).join(",");
}

/** `term` for a LIKE / ILIKE pattern: `\\`, `%` and `_` match themselves. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
