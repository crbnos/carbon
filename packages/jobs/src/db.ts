import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver } from "kysely";

/** Cached per pool size, like the pool itself. The engine, matcher and queue
 * drainer each ask for a client on every step, and a fresh Kysely instance per
 * call rebuilds the whole query-compiler graph for no gain. */
const clientCache = new Map<number, Kysely<KyselyDatabase>>();

/** `getPostgresClient` is typed against the edge runtime's vendored kysely, so
 * the structurally-identical instance needs a cast for this package's copy. */
export function getJobDatabaseClient(size = 1) {
  const cached = clientCache.get(size);
  if (cached !== undefined) return cached;

  const pool = getPostgresConnectionPool(size);
  const client = getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
  clientCache.set(size, client);
  return client;
}

export type JobDatabase = ReturnType<typeof getJobDatabaseClient>;
