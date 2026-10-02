// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** How many things `map`, `all`, `allSettled` and `limit` run at once unless told otherwise. */
export const DEFAULT_CONCURRENCY = 8;

type MaybePromise<T> = T | Promise<T>;

export type ConcurrencyOptions = { concurrency?: number };

type Tasks = readonly (() => unknown)[];

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

/**
 * p-limit: `limit(fn)` runs `fn` once fewer than `concurrency` of the calls
 * made through this `limit` are running, in the order they were made.
 * `activeCount` and `pendingCount` say how many are running and queued.
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
  const run = async <R>(fn: () => MaybePromise<R>): Promise<R> => {
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
  return Object.defineProperties(run, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length }
  }) as typeof run & {
    readonly activeCount: number;
    readonly pendingCount: number;
  };
}

/**
 * p-map: `Promise.all(items.map(mapper))`, at most `concurrency` at a time,
 * results in input order. Rejects with the first failure and starts nothing
 * after it.
 */
function map<T, R>(
  items: Iterable<T>,
  mapper: (item: T, index: number) => MaybePromise<R>,
  { concurrency }: ConcurrencyOptions = {}
): Promise<R[]> {
  const run = limit(concurrency);
  // Read the input to the end before anything starts: if iterating it throws,
  // no mapper is left running with nobody watching its result.
  const list = Array.from(items);
  let failed = false;
  return Promise.all(
    list.map((item, index) =>
      run(async () => {
        // The result is already a rejection; nobody reads this value.
        if (failed) return undefined as R;
        try {
          return await mapper(item, index);
        } catch (error) {
          failed = true;
          throw error;
        }
      })
    )
  );
}

/**
 * p-all: `Promise.all` over functions instead of promises, so at most
 * `concurrency` run at a time. Results keep the tuple's types and order.
 */
function all<const T extends Tasks>(tasks: T, options?: ConcurrencyOptions) {
  return map(tasks, (task) => task(), options) as Promise<{
    -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
  }>;
}

/** p-settle: `Promise.allSettled` over functions, at most `concurrency` at a time. */
function allSettled<const T extends Tasks>(
  tasks: T,
  { concurrency }: ConcurrencyOptions = {}
) {
  const run = limit(concurrency);
  return Promise.allSettled(tasks.map((task) => run(task))) as Promise<{
    -readonly [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>>;
  }>;
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
  // `onError` is the last resort: if it throws too, there is nowhere left to
  // report it, and an unhandled rejection can take the process down.
  const work = Promise.resolve()
    .then(task)
    .catch(onError)
    .catch(() => {});
  extendLifetime?.(work);
}

/**
 * Registers what keeps the process alive for background work: on a host that
 * freezes it once the response is sent, its `waitUntil`. Each app registers it
 * once at startup. Without one, unawaited work stalls mid-flight until the
 * next request wakes the instance, or is lost.
 */
function onBackground(
  hook: ((work: Promise<unknown>) => void) | undefined
): void {
  extendLifetime = hook;
}

/**
 * `Promise.all`, `Promise.allSettled` and `items.map` with a limit on how many
 * run at once (8 unless told otherwise). Tasks are functions, since a promise
 * is already running. Database calls inside a request need no limit of their
 * own: the Supabase client from `requirePermissions` runs at most 8 at once.
 *
 *   const [order, lines] = await async.all([
 *     () => getOrder(client, id),
 *     () => getLines(client, id)
 *   ]);
 *   const rows = await async.map(ids, (id) => load(id), { concurrency: 4 });
 *   const results = await async.allSettled(ids.map((id) => () => sync(id)));
 *   async.background(() => track(event), (error) => logger.error("…", { error }));
 *   async.onBackground(waitUntil); // once at startup, on a host that freezes
 */
export const async = {
  all,
  allSettled,
  map,
  limit,
  background,
  onBackground
} as const;
