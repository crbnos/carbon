// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  getPostgresClient,
  getProcessPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { queryLog, traceConnectionWaits } from "@carbon/logger/tracing.server";
import { type Kysely, PostgresDriver } from "kysely";

let client: Kysely<KyselyDatabase> | undefined;
let clientPool: ReturnType<typeof getProcessPool> | undefined;

/**
 * The jobs' Kysely client, over the process's one pool (`getProcessPool`),
 * built once: the engine, matcher and queue drainer ask for it on every step,
 * and a fresh instance per call rebuilds the whole query-compiler graph. It is
 * rebuilt only if a script ended the pool and a new one replaced it.
 *
 * `getPostgresClient` is typed against the edge runtime's vendored kysely, so
 * the structurally-identical instance needs a cast for this package's copy.
 */
export function getJobDatabaseClient(): Kysely<KyselyDatabase> {
  const pool = getProcessPool();
  if (!client || clientPool !== pool) {
    clientPool = traceConnectionWaits(pool);
    client = getPostgresClient(
      pool,
      PostgresDriver,
      queryLog
    ) as unknown as Kysely<KyselyDatabase>;
  }
  return client;
}

export type JobDatabase = ReturnType<typeof getJobDatabaseClient>;
