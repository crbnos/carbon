// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  all,
  allSettled,
  type ConcurrencyOptions,
  DEFAULT_CONCURRENCY
} from "./all";

/** Return this from a `map` mapper to leave the element out of the result. */
const skip: unique symbol = Symbol("async.skip");

type MaybePromise<T> = T | Promise<T>;

export type MapOptions = ConcurrencyOptions & {
  /**
   * `true` (default): reject with the first failure and start nothing after it.
   * `false`: run every element, then reject with an `AggregateError` of all
   * failures.
   */
  stopOnError?: boolean;
  /** Rejects with the signal's reason and starts nothing after it aborts. */
  signal?: AbortSignal;
};

/**
 * p-map's API: `mapper` over every element of an iterable or async iterable,
 * at most `concurrency` at a time, results in input order. The input is pulled
 * lazily, one element per free slot, and may hold promises. The one difference
 * from p-map is the default `concurrency`: DEFAULT_CONCURRENCY, not Infinity.
 * (`pMapIterable` is not ported.)
 */
function map<T, R>(
  input: Iterable<MaybePromise<T>> | AsyncIterable<MaybePromise<T>>,
  mapper: (element: T, index: number) => MaybePromise<R | typeof skip>,
  {
    concurrency = DEFAULT_CONCURRENCY,
    stopOnError = true,
    signal
  }: MapOptions = {}
): Promise<Exclude<R, typeof skip>[]> {
  return new Promise((resolve, reject) => {
    if (
      !(Number.isSafeInteger(concurrency) && concurrency >= 1) &&
      concurrency !== Number.POSITIVE_INFINITY
    ) {
      throw new TypeError(
        `Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\``
      );
    }

    const iterator =
      Symbol.asyncIterator in input
        ? input[Symbol.asyncIterator]()
        : input[Symbol.iterator]();
    const results: (R | typeof skip)[] = [];
    const errors: unknown[] = [];
    let index = 0;
    let lanes = 0;
    let active = 0;
    let exhausted = false;
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      finish();
    };
    const fail = (reason: unknown) => settle(() => reject(reason));
    const onAbort = () => fail(signal?.reason);
    const done = () =>
      settle(() =>
        errors.length > 0
          ? reject(new AggregateError(errors, "Some mappers failed"))
          : resolve(
              results.filter(
                (value): value is Exclude<R, typeof skip> => value !== skip
              )
            )
      );

    // One lane maps one element at a time. It opens the next lane after its
    // first pull, so no more lanes exist than elements or `concurrency`.
    const lane = async () => {
      let first = true;
      while (!settled && !exhausted) {
        const i = index++;
        const item = await iterator.next();
        if (item.done) {
          exhausted = true;
          break;
        }
        if (first && lanes < concurrency) {
          lanes++;
          lane().catch(fail);
        }
        first = false;
        active++;
        try {
          const element = await item.value;
          if (settled) return;
          results[i] = await mapper(element, i);
        } catch (error) {
          if (stopOnError) throw error;
          errors.push(error);
          results[i] = skip;
        }
        active--;
      }
      if (exhausted && active === 0) done();
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    lanes = 1;
    lane().catch(fail);
  });
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
 * `map` follows p-map, `all` / `allSettled` follow better-all.
 *
 *   const { order, lines } = await async.all({
 *     order: () => getOrder(client, id),
 *     lines: () => getLines(client, id)
 *   });
 *   const rows = await async.map(ids, (id) => load(id), { concurrency: 4 });
 *   const found = await async.map(ids, async (id) => (await find(id)) ?? async.skip);
 *   async.background(() => track(event), (error) => logger.error("…", { error }));
 */
export const async = { all, allSettled, map, skip, background } as const;
