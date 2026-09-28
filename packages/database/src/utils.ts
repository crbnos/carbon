import type {
  PostgrestClientOptions,
  PostgrestError,
  PostgrestFilterBuilder
} from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { KyselyDatabase } from "./client.ts";
import type { Database } from "./types.ts";

/**
 * Job statuses that participate in scheduling/planning ("open" work).
 * The DB enum can't express this business subset itself; `satisfies` binds
 * these values to the enum so a typo or an enum rename is a compile error,
 * and every consumer imports THIS constant instead of re-hardcoding strings.
 */
export const activeJobStatuses = [
  "Ready",
  "In Progress",
  "Paused"
] as const satisfies readonly Database["public"]["Enums"]["jobStatus"][];

/**
 * Either data-access handle a helper might receive: a Supabase client or a
 * Kysely handle (a `Kysely` instance or an active `Transaction`). Use it to
 * overload a helper that some callers reach with a client and others with
 * Kysely, instead of maintaining two near-identical `*Db` twins.
 */
export type AnyPostgresClient =
  | SupabaseClient<Database>
  | Kysely<KyselyDatabase>;

/**
 * Runtime guard narrowing {@link AnyPostgresClient} to the Kysely handle. Kysely
 * exposes `.selectFrom`; the Supabase client does not.
 */
export const isKysely = (db: AnyPostgresClient): db is Kysely<KyselyDatabase> =>
  typeof (db as Kysely<KyselyDatabase>).selectFrom === "function";

const BATCH_SIZE = 1000;
// How many pages to request at once past the first. Serial paging made a 150k-row
// table 150 sequential round trips.
const PAGE_CONCURRENCY = 4;
// Backstop only: a server that ignored `Range` would otherwise loop forever.
const MAX_PAGES = 1000;

export type PaginatedResult<T> =
  | {
      data: T[];
      count: number;
      error: null;
    }
  | {
      data: null;
      count: null;
      error: PostgrestError;
    };

type PageQuery<T extends object> = PostgrestFilterBuilder<
  PostgrestClientOptions,
  Database["public"],
  Record<string, unknown>,
  T[]
>;

/**
 * Fetches all records from a table by automatically handling pagination
 * to work around Supabase's 1000 row limit per request.
 *
 * Takes a FACTORY, not a query: supabase-js builders are mutable — `.range()`
 * sets `this.url.searchParams` and returns `this` — so concurrent awaits on one
 * builder would all fetch whichever range was set last. Mirrors the Deno sibling
 * `supabase/functions/lib/fetch-all.ts`.
 */
export async function fetchAllRecords<T extends object>(
  buildQuery: () => PageQuery<T>
): Promise<PaginatedResult<T>> {
  const fetchPage = async (page: number) =>
    await buildQuery().range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);

  // The first page alone, so a table that fits in one page stays at one request.
  const first = await fetchPage(0);
  if (first.error) {
    return { data: null, count: null, error: first.error };
  }

  const allData: T[] = first.data ?? [];
  if (allData.length < BATCH_SIZE) {
    return { data: allData, count: allData.length, error: null };
  }

  for (let page = 1; page < MAX_PAGES; page += PAGE_CONCURRENCY) {
    const results = await Promise.all(
      Array.from({ length: PAGE_CONCURRENCY }, (_, i) => fetchPage(page + i))
    );

    // In page order, so the first SHORT page ends the read. Pages after it are
    // speculative — they were issued before we knew where the data stopped, and
    // a read past the end can legitimately fail (PostgREST answers an
    // out-of-range `Range` with 416). Scanning every result for an error first
    // would turn that into a failed fetch after the rows were already in hand.
    for (const result of results) {
      if (result.error) {
        return { data: null, count: null, error: result.error };
      }

      const rows = (result.data ?? []) as T[];
      allData.push(...rows);
      if (rows.length < BATCH_SIZE) {
        return { data: allData, count: allData.length, error: null };
      }
    }
  }

  return {
    data: null,
    count: null,
    error: {
      message: `fetchAllRecords exceeded ${MAX_PAGES} pages — refusing to return a partial read`,
      details: "",
      hint: "",
      code: "PGRST_PAGINATION_LIMIT",
      name: "PostgrestError"
    } as PostgrestError
  };
}

/**
 * Helper function for simple table queries that need all records
 */
export async function fetchAllFromTable<T extends object>(
  client: SupabaseClient<Database>,
  tableName:
    | keyof Database["public"]["Tables"]
    | keyof Database["public"]["Views"],
  selectColumns: string = "*",
  filterFn?: (query: any) => any
): Promise<PaginatedResult<T>> {
  // No `count: "exact"` — that is a COUNT(*) OVER () across the whole filtered
  // set on EVERY page, and no caller reads the returned count.
  const buildQuery = () => {
    const query = client
      // @ts-expect-error
      .from(tableName)
      .select(selectColumns);

    return (filterFn ? filterFn(query) : query) as PageQuery<T>;
  };

  return fetchAllRecords<T>(buildQuery);
}

/**
 * Fetches records with automatic batching for queries that might exceed 1000 rows
 * Used when you need all records but want to process them in batches
 */
export async function* fetchRecordsInBatches<T extends object>(
  baseQuery: PostgrestFilterBuilder<
    PostgrestClientOptions,
    Database["public"],
    Record<string, unknown>,
    T[]
  >,
  batchSize: number = BATCH_SIZE
): AsyncGenerator<{ data: T[]; batch: number; hasMore: boolean }> {
  let offset = 0;
  let batch = 0;
  let hasMore = true;

  while (hasMore) {
    const query = baseQuery.range(offset, offset + batchSize - 1);
    const result = await query;

    if (result.error) {
      throw new Error(`Batch query failed: ${result.error.message}`);
    }

    hasMore = result.data && result.data.length === batchSize;
    batch++;

    yield {
      data: result.data || [],
      batch,
      hasMore
    };

    offset += batchSize;
  }
}
