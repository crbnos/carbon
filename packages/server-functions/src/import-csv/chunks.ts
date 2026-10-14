// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rows per INSERT. Every multi-row insert is bound by Postgres' 65535 bind
// parameters: the widest table written (itemLedger, 14 columns) is ~7k
// parameters at this size.
const INSERT_CHUNK_SIZE = 500;

export function chunked<T>(rows: T[], size = INSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `insert` once per chunk of `rows`, one after another (they share a
 * transaction), and returns every chunk's RETURNING rows in input order.
 */
export async function inChunks<T, R>(
  rows: T[],
  insert: (chunk: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  for (const chunk of chunked(rows)) {
    results.push(...(await insert(chunk)));
  }
  return results;
}
