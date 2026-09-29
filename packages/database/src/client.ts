import {
  type Driver,
  Kysely,
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

// A pg.Pool is a long-lived singleton; creating one per invocation (per inngest
// event handler / cron tick) and never ending it leaks connections and exhausts
// `max_connections`.
const poolCache = new Map<number, pg.Pool>();

export function getPostgresConnectionPool(connections: number): pg.Pool {
  const cached = poolCache.get(connections);
  // An ended pool can never serve connections again ("Cannot use a pool after
  // calling end on the pool") — evict it so callers get a live pool instead of
  // a permanently broken process.
  if (cached && !cached.ending) return cached;

  const pool = createPostgresConnectionPool(connections);
  poolCache.set(connections, pool);
  return pool;
}

function createPostgresConnectionPool(connections: number): pg.Pool {
  const url = process.env.SUPABASE_DB_URL!;
  const connectionPoolerUrl = url.includes("supabase.co")
    ? url.replace("5432", "6543")
    : url;
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
  driver: PgDriverConstructor
): Kysely<D> {
  return new Kysely<D>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new driver({ pool }),
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
}
