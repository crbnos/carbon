import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver } from "kysely";

/**
 * The Kysely client for background jobs. `getPostgresClient` is typed against
 * the edge runtime's vendored kysely, so the structurally-identical instance
 * needs a cast to satisfy this package's copy.
 */
export function getJobDatabaseClient(size = 1) {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
}

export type JobDatabase = ReturnType<typeof getJobDatabaseClient>;
