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
 * A PostgREST `.or()` filter matching `term` anywhere in any of `columns`.
 * The term is quoted, so a comma, dot or parenthesis in it is text, not
 * filter syntax: interpolated bare, "a,b" ended the filter early and the
 * request failed.
 */
export function searchFilter(columns: string[], term: string): string {
  const quoted = `"%${term.replace(/["\\]/g, (char) => `\\${char}`)}%"`;
  return columns.map((column) => `${column}.ilike.${quoted}`).join(",");
}
