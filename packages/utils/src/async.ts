/**
 * Promise helpers, used as a namespace: `import { async } from "@carbon/utils"`,
 * then `async.map`, `async.all`, `async.allSettled`, `async.background`.
 */
export { all, allSettled } from "./all";

/**
 * Maps `items` through `fn` with at most `concurrency` calls in flight (default:
 * all at once, like `Promise.all`). Results keep input order. The first rejection
 * rejects the whole map and stops new calls from starting; calls already in
 * flight run to completion.
 */
export async function map<T, R>(
  items: Iterable<T>,
  fn: (item: T, index: number) => Promise<R>,
  { concurrency = Number.POSITIVE_INFINITY }: { concurrency?: number } = {}
): Promise<R[]> {
  const list = [...items];
  const results = new Array<R>(list.length);
  let next = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && next < list.length) {
      const index = next++;
      try {
        results[index] = await fn(list[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const workers = Math.min(Math.max(1, concurrency), list.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Starts `task` without waiting for it. A rejection (or a synchronous throw)
 * goes to `onError` instead of becoming an unhandled rejection — the caller
 * must decide how a background failure is reported.
 */
export function background(
  task: () => Promise<unknown>,
  onError: (error: unknown) => void
): void {
  Promise.resolve().then(task).catch(onError);
}
