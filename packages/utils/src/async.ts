// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  all,
  allSettled,
  type ConcurrencyOptions,
  DEFAULT_CONCURRENCY
} from "./all";

/**
 * `fn` over every item, at most `concurrency` at a time, results in input
 * order. Rejects with the first failure and starts no further items after it.
 */
async function map<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R> | R,
  { concurrency = DEFAULT_CONCURRENCY }: ConcurrencyOptions = {}
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Starts work nobody waits for. A failure goes to `onError`, which is required:
 * a detached promise with no handler is an unhandled rejection.
 */
function background(
  task: () => Promise<unknown> | unknown,
  onError: (error: unknown) => void
): void {
  Promise.resolve().then(task).catch(onError);
}

/**
 * Concurrency helpers. Prefer these to `Promise.all` over a list or a set of
 * queries: everything here runs at most `concurrency` things at once
 * (default 8), so one caller cannot take every database connection.
 *
 *   const { order, lines } = await async.all({
 *     order: () => getOrder(client, id),
 *     lines: () => getLines(client, id)
 *   });
 *   const rows = await async.map(ids, (id) => load(id), { concurrency: 4 });
 *   async.background(() => track(event), (error) => logger.error("…", { error }));
 */
export const async = { all, allSettled, map, background };
