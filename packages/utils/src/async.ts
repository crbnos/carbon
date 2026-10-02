// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { all, allSettled, flow } from "better-all";

/** How many things `map` and `limit` run at once unless told otherwise. */
export const DEFAULT_CONCURRENCY = 8;

/** Return this from a `map` mapper to leave the element out of the result. */
const skip: unique symbol = Symbol("async.skip");

type MaybePromise<T> = T | Promise<T>;

export type MapOptions = {
  concurrency?: number;
  /**
   * `true` (default): reject with the first failure and start nothing after it.
   * `false`: run every element, then reject with an `AggregateError` of all
   * failures.
   */
  stopOnError?: boolean;
  /** Rejects with the signal's reason and starts nothing after it aborts. */
  signal?: AbortSignal;
};

function assertConcurrency(concurrency: number) {
  if (
    !(Number.isSafeInteger(concurrency) && concurrency >= 1) &&
    concurrency !== Number.POSITIVE_INFINITY
  ) {
    throw new TypeError(
      `Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\``
    );
  }
}

async function collect<T>(input: Iterable<T> | AsyncIterable<T>) {
  const items: Awaited<T>[] = [];
  for await (const item of input) items.push(item);
  return items;
}

/** Rejects with the signal's reason when it aborts; never settles otherwise. */
function abortion(signal: AbortSignal | undefined, cleanup: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
      signal: cleanup
    });
  });
}

/**
 * p-map: `mapper` over every element of an iterable or async iterable, at most
 * `concurrency` at a time, results in input order. Each of `concurrency`
 * workers pulls the next element when it is free, so the input is read
 * lazily, and an element may be a promise. The one difference from p-map is
 * the default `concurrency`: DEFAULT_CONCURRENCY, not Infinity.
 */
async function map<T, R>(
  input: Iterable<MaybePromise<T>> | AsyncIterable<MaybePromise<T>>,
  mapper: (element: T, index: number) => MaybePromise<R | typeof skip>,
  {
    concurrency = DEFAULT_CONCURRENCY,
    stopOnError = true,
    signal
  }: MapOptions = {}
): Promise<Exclude<R, typeof skip>[]> {
  assertConcurrency(concurrency);
  signal?.throwIfAborted();

  // With no limit everything starts at once, so an iterable is read to the
  // end first: its length says how many workers to start.
  const source =
    concurrency === Number.POSITIVE_INFINITY && !Array.isArray(input)
      ? await collect(input)
      : input;
  const workers = Array.isArray(source)
    ? Math.min(concurrency, source.length)
    : concurrency;
  const iterator =
    Symbol.asyncIterator in source
      ? source[Symbol.asyncIterator]()
      : source[Symbol.iterator]();
  const results: (R | typeof skip)[] = [];
  const errors: unknown[] = [];
  let index = 0;
  let stopped = false;

  const worker = async () => {
    while (!stopped && !signal?.aborted) {
      const i = index++;
      const item = await iterator.next();
      if (item.done) return;
      try {
        results[i] = await mapper(await item.value, i);
      } catch (error) {
        if (stopOnError) {
          stopped = true;
          throw error;
        }
        errors.push(error);
        results[i] = skip;
      }
    }
  };

  const done = new AbortController();
  try {
    await Promise.race([
      Promise.all(Array.from({ length: workers }, worker)),
      abortion(signal, done.signal)
    ]);
  } finally {
    stopped = true;
    done.abort();
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Some mappers failed");
  }
  return results.filter(
    (value): value is Exclude<R, typeof skip> => value !== skip
  );
}

/**
 * p-limit: `limit(fn)` runs `fn` once fewer than `concurrency` of the calls
 * made through this `limit` are running, in the order they were made.
 */
function limit(concurrency = DEFAULT_CONCURRENCY) {
  assertConcurrency(concurrency);
  let active = 0;
  const queue: (() => void)[] = [];
  // A freed slot passes straight to the next queued call, so a call made
  // before that one resumes cannot take it.
  const next = () => {
    const waiter = queue.shift();
    if (waiter) waiter();
    else active--;
  };
  return async <R>(fn: () => MaybePromise<R>): Promise<R> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

let extendLifetime: ((work: Promise<unknown>) => void) | undefined;

/**
 * Starts work nobody waits for. A failure goes to `onError`, which is required:
 * a detached promise with no handler is an unhandled rejection.
 *
 * The work is handed to the host's lifetime hook when one is registered (see
 * `onBackground`), so it is not cut off when the response has been sent.
 */
function background(
  task: () => Promise<unknown> | unknown,
  onError: (error: unknown) => void
): void {
  const work = Promise.resolve().then(task).catch(onError);
  extendLifetime?.(work);
}

/**
 * Registers what keeps the process alive for background work: on a host that
 * freezes it once the response is sent, its `waitUntil`. Each app registers it
 * once at startup. Without one, unawaited work stalls mid-flight until the
 * next request wakes the instance, or is lost.
 */
function onBackground(hook: (work: Promise<unknown>) => void): void {
  extendLifetime = hook;
}

/**
 * Promise helpers with the APIs of the libraries they follow: `map` and `skip`
 * are p-map's, `limit` is p-limit's, `all` / `allSettled` / `flow` are
 * better-all's. Database calls need no limit of their own: the Supabase client
 * a request gets from `requirePermissions` runs at most 8 calls at once.
 *
 *   const { order, lines } = await async.all({
 *     order: () => getOrder(client, id),
 *     async lines() { return getLines(client, (await this.$.order).id) }
 *   });
 *   const rows = await async.map(ids, (id) => load(id), { concurrency: 4 });
 *   const found = await async.map(ids, async (id) => (await find(id)) ?? async.skip);
 *   async.background(() => track(event), (error) => logger.error("…", { error }));
 *   async.onBackground(waitUntil); // once at startup, on a host that freezes
 */
export const async = {
  all,
  allSettled,
  flow,
  map,
  skip,
  limit,
  background,
  onBackground
} as const;
