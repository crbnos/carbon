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
 * PostgREST filters travel in the URL, so an `.in()` list is bounded by the
 * gateway's request-line limit rather than by anything in Postgres. Measured
 * against Supabase's Kong + PostgREST: an encoded request line of 3,821 bytes
 * succeeds and one of 4,001 fails, so the ceiling is 4 KB. Above ~6 KB Kong
 * answers 414 itself; between the two it forwards and PostgREST rejects the
 * request line, which Kong reports as a 502 "invalid response from upstream" —
 * a confusing way to be told a list was too long.
 *
 * The limit is BYTES, not values. A batch of 200 nine-character part numbers
 * fits; 60 fifty-eight-character external ids does not. Chunking on a fixed
 * count is therefore not safe on its own — it is exactly how a list of long
 * ids slips past a limit tuned for short ones.
 */

/** Bytes left for everything else on the line: path, select, other filters. */
const FILTER_BYTE_BUDGET = 3000;

/** An encoded "," between two values. */
const SEPARATOR_BYTES = 3;

/** Two encoded quotes, added by supabase-js when a value contains , ( or ). */
const QUOTE_BYTES = 6;

/** What one value costs in the encoded query string, exactly. */
function filterValueBytes(value: string): number {
  // `v=` is two characters of the serialization, not of the value.
  const encoded = new URLSearchParams({ v: value }).toString().length - 2;
  return encoded + (/[,()]/.test(value) ? QUOTE_BYTES : 0);
}

/**
 * Split values for an `.in()` filter into batches whose encoded length stays
 * under the request-line limit. Values are deduped, and order is preserved so
 * a caller reassembling results gets them in a predictable sequence.
 *
 * A single value longer than the budget still gets its own batch: it cannot be
 * split, and failing loudly on that one request beats silently dropping it.
 */
export function chunkFilterValues(
  values: string[],
  options: { budgetBytes?: number } = {}
): string[][] {
  const budget = options.budgetBytes ?? FILTER_BYTE_BUDGET;
  const batches: string[][] = [];
  let current: string[] = [];
  let used = 0;

  for (const value of new Set(values)) {
    const cost = filterValueBytes(value) + SEPARATOR_BYTES;
    if (current.length > 0 && used + cost > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(value);
    used += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Run a PostgREST query once per batch of `values` and concatenate the rows.
 *
 * The caller supplies the query for one batch, so every filter, select and
 * ordering stays where it is legible — this only decides how many times to
 * ask. The first error wins and stops the run: a partial result read as a
 * whole one is how a sync decides a row is missing and deletes it.
 */
export async function selectInBatches<Row, Err>(
  values: string[],
  runBatch: (batch: string[]) => PromiseLike<{
    data: Row[] | null;
    error: Err | null;
  }>,
  options: { budgetBytes?: number } = {}
): Promise<{ data: Row[]; error: Err | null }> {
  const batches = chunkFilterValues(values, options);
  const rows: Row[] = [];
  for (const batch of batches) {
    const result = await runBatch(batch);
    if (result.error) return { data: [], error: result.error };
    if (result.data) rows.push(...result.data);
  }
  return { data: rows, error: null };
}
