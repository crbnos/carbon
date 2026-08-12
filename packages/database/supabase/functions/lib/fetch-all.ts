// Deno mirror of @carbon/database's fetchAllFromTable: pages through PostgREST
// in 1000-row batches so reads are complete past the production `max_rows`
// cap. The local dev stack does not enforce the cap, which is exactly why
// truncated reads ship unnoticed — always use this for a read that can exceed
// 1000 rows.

// deno-lint-ignore-file no-explicit-any

const BATCH_SIZE = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAll<T>(
  buildQuery: () => any
): Promise<PageResult<T>> {
  const allData: T[] = [];
  let offset = 0;

  while (true) {
    const result = await buildQuery().range(offset, offset + BATCH_SIZE - 1);

    if (result.error) {
      return { data: null, error: result.error };
    }

    const rows: T[] = result.data ?? [];
    allData.push(...rows);

    if (rows.length < BATCH_SIZE) {
      return { data: allData, error: null };
    }
    offset += BATCH_SIZE;
  }
}
