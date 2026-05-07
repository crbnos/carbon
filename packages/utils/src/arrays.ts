/**
 * A utility type to get the element type of an array.
 */
export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

/**
 * A utility function to filter out null and undefined values from an array.
 *
 * Indexed loop instead of `.reduce` to avoid the per-call closure
 * allocation and keep the load IC at `arr[i]` monomorphic.
 */
export const filterEmpty = <
  T extends Array<any>,
  U = Exclude<ArrayElement<T>, null | undefined>
>(
  arr: T
): U[] => {
  const out: U[] = [];
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const item = arr[i];
    if (item !== null && item !== undefined) out.push(item);
  }
  return out;
};

// Chunk
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  const len = array.length;
  for (let i = 0; i < len; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Project rows to a value, drop null/undefined, dedupe. Common when
 * collecting foreign-key ids out of a result set to feed an `IN (...)`
 * query.
 *
 *   pluckUnique(rows, (r) => r.trackedEntityId)
 *
 * Replaces:
 *   Array.from(new Set(rows.map((r) => r.x).filter((v): v is T => !!v)))
 *
 * Hot-path notes (V8): always accepts a real array (callers normalize at
 * boundary), iterates with an indexed loop for a monomorphic load IC and
 * to skip iterator-protocol allocation, and keeps the output array packed
 * by only pushing non-null/undefined `U` values.
 */
export function pluckUnique<T, U>(
  rows: readonly T[] | null | undefined,
  selector: (row: T) => U | null | undefined
): NonNullable<U>[] {
  const out: NonNullable<U>[] = [];
  if (rows === null || rows === undefined) return out;
  const len = rows.length;
  if (len === 0) return out;
  const seen = new Set<NonNullable<U>>();
  for (let i = 0; i < len; i++) {
    const value = selector(rows[i]!);
    if (value === null || value === undefined) continue;
    if (seen.has(value as NonNullable<U>)) continue;
    seen.add(value as NonNullable<U>);
    out.push(value as NonNullable<U>);
  }
  return out;
}

/**
 * Build a `Map<K, T>` from an array, keyed by `getKey(row)`. Last write
 * wins on duplicate keys. Designed for the common pattern of:
 *
 *   const byId = new Map(rows.map((r) => [r.id, r]));
 *
 * Indexed loop, no iterator protocol — the `.map` form allocates
 * intermediate tuple arrays we don't need.
 */
export function indexBy<T, K>(
  rows: readonly T[] | null | undefined,
  getKey: (row: T) => K
): Map<K, T> {
  const out = new Map<K, T>();
  if (rows === null || rows === undefined) return out;
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i]!;
    out.set(getKey(row), row);
  }
  return out;
}

/**
 * Same as `indexBy` but lets the caller transform the value while
 * indexing — useful for normalising rows into a synthetic shape (e.g.
 * flattening a `string[]` column into the first element under a different
 * key) without an extra `.map` pass.
 */
export function indexByMapped<T, K, V>(
  rows: readonly T[] | null | undefined,
  getKey: (row: T) => K,
  getValue: (row: T) => V
): Map<K, V> {
  const out = new Map<K, V>();
  if (rows === null || rows === undefined) return out;
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i]!;
    out.set(getKey(row), getValue(row));
  }
  return out;
}
