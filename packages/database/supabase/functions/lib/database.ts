// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Aliased it as pg so can be imported as-is in Node environment
import { Pool } from "pg";
import { PostgresDriver } from "./driver.ts";
import { getPostgresClient, getPostgresConnectionPool, KyselyDatabase } from "./postgres/index.ts";

export type DB = KyselyDatabase

export const getConnectionPool = getPostgresConnectionPool

export function getDatabaseClient<_>(pool: Pool) {
  return getPostgresClient(pool, PostgresDriver)
}
