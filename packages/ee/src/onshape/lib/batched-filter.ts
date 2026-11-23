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

// PostgREST's `max_rows` cap. A page shorter than this is the last one.
const PAGE_SIZE = 1000;
// Backstop only: a server that ignored `Range` would otherwise loop forever.
const MAX_PAGES = 1000;

/**
 * What paging needs from a batch query. Structural, as `fetchAllRecords`
 * (`@carbon/database`) types it: naming the supabase-js builder makes the
 * compiler walk the whole schema per call.
 */
export type BatchQuery<Row, Err> = {
  order(
    column: string,
    options?: { ascending?: boolean }
  ): BatchQuery<Row, Err>;
  range(
    from: number,
    to: number
  ): PromiseLike<{ data: Row[] | null; error: Err | null }>;
};

/**
 * Runs the query once per batch and concatenates the rows. Each batch is paged
 * past PostgREST's 1,000-row cap: a batch of values can match more rows than
 * that (lines of many methods), and a cut read loses rows silently. Pages are
 * ordered by `orderBy` (default `id`), appended after any order the query
 * sets, so offsets are stable. `buildBatch` is called once per page:
 * supabase-js builders are mutable. The first error returns no rows: a partial
 * result read as whole makes a sync delete rows.
 */
export async function selectInBatches<Row, Err>(
  values: string[],
  buildBatch: (batch: string[]) => BatchQuery<Row, Err>,
  options: { budgetBytes?: number; orderBy?: string } = {}
): Promise<{ data: Row[]; error: Err | null }> {
  const batches = chunkFilterValues(values, options);
  const orderBy = options.orderBy ?? "id";
  const rows: Row[] = [];
  for (const batch of batches) {
    for (let page = 0; ; page += 1) {
      if (page === MAX_PAGES) {
        throw new Error(
          `selectInBatches exceeded ${MAX_PAGES} pages; refusing a partial read`
        );
      }
      const from = page * PAGE_SIZE;
      const result = await buildBatch(batch)
        .order(orderBy)
        .range(from, from + PAGE_SIZE - 1);
      if (result.error) return { data: [], error: result.error };
      const pageRows = result.data ?? [];
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) break;
    }
  }
  return { data: rows, error: null };
}
