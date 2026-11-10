// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Bounded parallel map, without runtime `@carbon/*` imports (the drift check
 * runs under bare `tsx`).
 */

/** Tables the backup jobs read or write at once: each holds a connection of
 *  the job process's shared pool (16) while it runs. */
export const TABLE_CONCURRENCY = 6;

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item === undefined) break;
        await fn(item);
      }
    }
  );
  await Promise.all(workers);
}
