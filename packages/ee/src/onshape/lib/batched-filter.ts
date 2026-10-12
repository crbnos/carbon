// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// PostgREST filters travel in the URL, so an `.in()` list is bounded by the
// gateway's 4 KB request line (Kong answers 414 or 502 above it), measured in
// bytes rather than values.
const FILTER_BYTE_BUDGET = 3000;

const SEPARATOR_BYTES = 3;

// supabase-js quotes a value containing , ( or ).
const QUOTE_BYTES = 6;

function filterValueBytes(value: string): number {
  // - 2 drops the "v=" of the serialization.
  const encoded = new URLSearchParams({ v: value }).toString().length - 2;
  return encoded + (/[,()]/.test(value) ? QUOTE_BYTES : 0);
}

/**
 * Dedupes values and splits them, in order, into `.in()` batches under the byte
 * budget. A value over the budget gets its own batch rather than being dropped.
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
 * Runs the query once per batch and concatenates the rows. The first error
 * returns no rows: a partial result read as whole makes a sync delete rows.
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
