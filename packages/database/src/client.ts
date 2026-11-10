// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Driver,
  Kysely,
  type KyselyConfig,
  PostgresAdapter,
  type PostgresDialectConfig,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Transaction
} from "kysely";
import type { KyselifyDatabase } from "kysely-supabase";
import * as pg from "pg";
import type { Database as SupabaseDatabase } from "./types";

export type KyselyDatabase = KyselifyDatabase<SupabaseDatabase>;
export type DB = KyselyDatabase;
export type KyselyTx = Transaction<KyselyDatabase>;
export type KyselyDbTx = KyselyDatabase | KyselyTx;

export type { ExpressionBuilder, Kysely } from "kysely";

/**
 * Runs `fn` in a transaction: the one `db` already is, else a new one. Kysely
 * refuses `transaction()` on a `Transaction`, so a function that may be handed
 * either joins through this rather than opening its own.
 */
export function withTransaction<T>(
  db: Kysely<KyselyDatabase>,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<KyselyDatabase>);
  return db.transaction().execute(fn);
}

/** NUMERIC. node-postgres hands it over as text by default, so a scale-5 price
 *  would arrive as a string where the generated types promise a number. */
const NUMERIC_OID = 1700;

/** DATE. node-postgres parses `YYYY-MM-DD` into a JS `Date` at LOCAL midnight
 *  (`postgres-date`: "Force YYYY-MM-DD dates to be parsed as local time"), where
 *  the generated types promise a string — `KyselyDatabase` is
 *  `KyselifyDatabase<SupabaseDatabase>`, so `purchaseInvoice.dateIssued` is
 *  `string | null` to the compiler and a `Date` at runtime.
 *
 *  That gap is invisible to typecheck BY CONSTRUCTION: assigning the `Date` into
 *  something already declared `string` is exactly what the compiler has been told
 *  to expect. It has shipped as a bug at least twice — a `.slice` crash on the
 *  Rillet payment push, and every Ramp draft bill rejected
 *  `422 "Not a valid date"` because a `Date` JSON-serializes as a full timestamp.
 *
 *  Identity, not a reformat: Postgres' wire text for a DATE is `2026-09-15`,
 *  byte-identical to what PostgREST returns, so the Kysely and Supabase clients
 *  agree.
 *
 *  **Deliberately NOT applied to the timestamp OIDs** (1114 / 1184), even though
 *  they carry the same mismatch. Postgres sends `2026-09-15 16:36:52.677+00`
 *  (space-separated, `+00`) where PostgREST sends
 *  `2026-09-15T16:36:52.677+00:00`. An identity parser there would make the two
 *  clients return differently-shaped strings for one column — still `string`, no
 *  longer interchangeable. Fixing those needs a normalizing parser and its own
 *  verification pass.
 *
 *  `date[]` (OID 1182) is unaffected: node-postgres' array parser calls
 *  `postgres-date` directly rather than the registered element parser. There are
 *  no `date[]` columns in the schema today. */
const DATE_OID = 1082;

const identity = (value: string): string => value;

/** node-postgres keeps type parsers in a PROCESS-GLOBAL registry, so these are
 *  registered once at module load rather than as a side effect of constructing a
 *  pool. The namespace and its `default` both carry `types` depending on interop. */
const pgTypes = ((pg as { types?: typeof pg.types }).types ??
  (pg as unknown as { default?: typeof pg }).default?.types)!;
pgTypes.setTypeParser(NUMERIC_OID, Number);
pgTypes.setTypeParser(DATE_OID, identity);

/** Connections in a Node process's one pool. The pools it replaced (10, 5 and
 *  1, one per size asked for) held up to 16 between them. */
const PROCESS_POOL_SIZE = 16;
let processPool: pg.Pool | undefined;

/**
 * The Node process's one connection pool, shared by the app's Kysely client,
 * the jobs and the scripts. Only a script about to exit ends it. A pool per
 * caller let one process hold several, and a caller that ended its pool broke
 * everyone else holding it.
 */
export function getProcessPool(): pg.Pool {
  // An ended pool can never serve again ("Cannot use a pool after calling end
  // on the pool"): a script that ended it and carries on gets a new one.
  if (!processPool || processPool.ending) {
    processPool = createPostgresConnectionPool(PROCESS_POOL_SIZE);
  }
  return processPool;
}

// The pooler URL only when it serves the connection SUPABASE_DB_URL names:
// the same database as the same user (Supavisor's user carries a .<tenant>
// suffix). A pooler on localhost is crbn's (.env.local), which fronts the
// PORT_DB crbn wrote next to it: a caller pointed at a remote server or at
// another local stack must not land on it. A pooler on another host (the
// self-host recipe's supavisor) was set on purpose, next to its own database.
const isLocalHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";
const dbUser = (u: URL) => decodeURIComponent(u.username).split(".")[0];

export function localPoolerUrl(
  url: string,
  pooler = process.env.SUPABASE_DB_POOLER_URL,
  directPort = process.env.PORT_DB
): string {
  if (!pooler) return url;
  try {
    const p = new URL(pooler);
    const u = new URL(url);
    if (p.pathname !== u.pathname || dbUser(p) !== dbUser(u)) return url;
    if (isLocalHost(p.hostname)) {
      if (!isLocalHost(u.hostname)) return url;
      if (directPort && u.port !== directPort) return url;
    }
    return pooler;
  } catch {
    return url;
  }
}

function createPostgresConnectionPool(connections: number): pg.Pool {
  const url = process.env.SUPABASE_DB_URL!;
  // Hosted: Supavisor's transaction port. Local dev: `crbn`'s PgBouncer, so
  // session-state bugs show up before production.
  const connectionPoolerUrl = url.includes("supabase.co")
    ? url.replace("5432", "6543")
    : localPoolerUrl(url);
  const pool = new pg.Pool({
    connectionString: connectionPoolerUrl,
    max: connections,
    // Fail fast instead of queueing forever when the DB/pooler is unreachable
    // or the pool is saturated.
    connectionTimeoutMillis: 10_000,
    // Rotate connections so direct (non-Supavisor) connections can't rot
    // through NAT/firewall idle limits.
    maxLifetimeSeconds: 1800
  });
  // pg-pool purges the broken client before emitting 'error'; the listener
  // exists because an unlistened EventEmitter 'error' crashes the process.
  pool.on("error", (err) => {
    console.error("postgres pool: idle client error", err);
  });
  return pool;
}

interface PgDriverConstructor {
  new (config: PostgresDialectConfig): Driver;
}

export function getPostgresClient<D = KyselyDatabase>(
  pool: pg.Pool,
  driver: PgDriverConstructor,
  log?: KyselyConfig["log"]
): Kysely<D> {
  return new Kysely<D>({
    log,
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new driver({ pool }),
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
}
