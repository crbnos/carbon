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

/**
 * Fetches all records from a table by automatically handling pagination
 * to work around Supabase's 1000 row limit per request
 */
export async function fetchAllRecords<T extends object>(
  baseQuery: PostgrestFilterBuilder<
    PostgrestClientOptions,
    Database["public"],
    Record<string, unknown>,
    T[]
  >
): Promise<PaginatedResult<T>> {
  const allData: T[] = [];
  let offset = 0;
  let totalCount: number = 0;
  let hasMore = true;

  while (hasMore) {
    // Clone the query and add range for this batch
    const query = baseQuery.range(offset, offset + BATCH_SIZE - 1);

    const result = await query;

    if (result.error) {
      return {
        data: null,
        count: null,
        error: result.error
      };
    }

    if (result.data) {
      allData.push(...result.data);
    }

    // Set total count from first request
    if (offset === 0) {
      totalCount = result.count ?? 0;
    }

    // Check if we have more data to fetch
    hasMore = result.data && result.data.length === BATCH_SIZE;
    offset += BATCH_SIZE;
  }

  return {
    data: allData,
    count: totalCount,
    error: null
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
  let baseQuery = client
    // @ts-expect-error
    .from(tableName)
    .select(selectColumns, { count: "exact" });

  if (filterFn) {
    baseQuery = filterFn(baseQuery);
  }

  // @ts-expect-error
  return fetchAllRecords(baseQuery);
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
