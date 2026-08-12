// Deno mirror of @carbon/database's fetchAllFromTable: pages through PostgREST
// in 1000-row batches so reads are complete past the production `max_rows`
// cap. The local dev stack does not enforce the cap, which is exactly why
// truncated reads ship unnoticed — always use this for a read that can exceed
// 1000 rows.

// deno-lint-ignore-file no-explicit-any

const BATCH_SIZE = 1000;
// Backstop only: a server that ignored `Range` would otherwise loop forever
// inside an edge function. 1000 pages = 1M rows, far past any real input.
const MAX_PAGES = 1000;

type PageResult<T> = {
  data: T[] | null;
  // Carries PostgREST's error through unchanged (code/details/hint included) —
  // narrowing it to a message would discard the diagnostics.
  error: { message: string; [key: string]: unknown } | null;
};

export async function fetchAll<T>(
  buildQuery: () => any
): Promise<PageResult<T>> {
  const allData: T[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * BATCH_SIZE;
    const result = await buildQuery().range(offset, offset + BATCH_SIZE - 1);

    if (result.error) {
      return { data: null, error: result.error };
    }

    const rows: T[] = result.data ?? [];
    allData.push(...rows);

    if (rows.length < BATCH_SIZE) {
      return { data: allData, error: null };
    }
  }

  return {
    data: null,
    error: {
      message: `fetchAll exceeded ${MAX_PAGES} pages — refusing to plan on a partial read`,
    },
  };
}
