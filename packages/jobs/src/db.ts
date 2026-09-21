import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver } from "kysely";

/** Cached per pool size, like the pool itself. The engine, matcher and queue
 * drainer each ask for a client on every step, and a fresh Kysely instance per
 * call rebuilds the whole query-compiler graph for no gain.
 *
 * We cache the pool ALONGSIDE the client so we can detect an ended pool: the
 * accounting sweeps (`accounting-outbound-sweep`, `-consolidation`,
 * `-reconciliation`) call `getPostgresConnectionPool(5)` — the SAME shared pool
 * this client wraps — and `pool.end()` it in a `finally`. `getPostgresConnectionPool`
 * evicts an ended pool for its own callers, but this separate client cache would
 * otherwise keep serving a Kysely bound to the dead pool, so every later
 * `getJobDatabaseClient(size)` user (e.g. `ramp-sync`) threw "Cannot use a pool
 * after calling end on the pool". Rebuild when the underlying pool is ending. */
const clientCache = new Map<
  number,
  {
    client: Kysely<KyselyDatabase>;
    pool: ReturnType<typeof getPostgresConnectionPool>;
  }
>();

/** `getPostgresClient` is typed against the edge runtime's vendored kysely, so
 * the structurally-identical instance needs a cast for this package's copy. */
export function getJobDatabaseClient(size = 1) {
  const cached = clientCache.get(size);
  // `ending` is node-postgres only; undefined on Deno (pool always reused).
  if (cached && !(cached.pool as { ending?: boolean }).ending) {
    return cached.client;
  }

  // getPostgresConnectionPool already evicts+rebuilds an ended pool, so this is
  // guaranteed live.
  const pool = getPostgresConnectionPool(size);
  const client = getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
  clientCache.set(size, { client, pool });
  return client;
}

export type JobDatabase = ReturnType<typeof getJobDatabaseClient>;
