// Aliased it as pg so can be imported as-is in Node environment
import { Pool } from "pg";
import { PostgresDriver } from "./driver.ts";
import { getPostgresClient, getPostgresConnectionPool, KyselyDatabase } from "./postgres/index.ts";

export type DB = KyselyDatabase

export const getConnectionPool = getPostgresConnectionPool

export function getDatabaseClient<_>(pool: Pool) {
  return getPostgresClient(pool, PostgresDriver)
}
