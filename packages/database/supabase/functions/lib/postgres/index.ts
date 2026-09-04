import {
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresDialectConfig,
  PostgresIntrospector,
  PostgresQueryCompiler,
  Transaction,
} from "kysely";
import type { KyselifyDatabase } from "./kysely-supabase.types.ts";
// Aliased it as pg so can be imported as-is in Node environment
import { Pool } from "pg";
import * as pg from "pg";
import type { Database as SupabaseDatabase } from "../../../../src/types.ts";

export type KyselyDatabase = KyselifyDatabase<SupabaseDatabase>;
// Type-only alias so Node-reachable code (the in-process scheduling engine) can
// name the Kysely DB shape WITHOUT importing ../database.ts, which pulls in the
// Deno-only postgres driver (driver.ts) and fails a Node typecheck. database.ts
// keeps re-exporting this same `DB` for the edge runtime.
export type DB = KyselyDatabase;
export type KyselyTx = Transaction<KyselyDatabase>;
export type KyselyDbTx = KyselyDatabase | KyselyTx;

export type { ExpressionBuilder, Kysely } from "kysely";

export function getRuntime() {
  if (typeof (globalThis as Record<string, unknown>).Deno !== "undefined") {
    return "deno";
  }

  if (typeof globalThis.window !== "undefined") {
    return "browser";
  }

  return "node";
}

// Reuse one long-lived pool per connection size instead of minting a fresh
// pool on every call. A pg.Pool is designed to be a long-lived singleton;
// creating one per invocation (e.g. per inngest event handler / cron tick)
// and never ending it leaks connections and exhausts `max_connections`.
// In Node this Map lives for the process; in Deno it's per-isolate (edge
// functions already create their pool once at module scope, so this is a
// no-op for them).
const poolCache = new Map<number, Pool>();

/** NUMERIC. Both drivers hand it over as text by default, so a scale-5 price
 *  would arrive as a string where the generated types promise a number. */
const NUMERIC_OID = 1700;

/** The deno-postgres constructor shape. "pg" resolves to node-postgres types in
 *  the Node build, so the Deno branch has to describe its own driver — but it
 *  describes it PROPERLY: the TLS block below is the one place a typo silently
 *  turns encryption off, which is not something to hand to `unknown`. */
type DenoTlsOptions = { enabled: boolean; enforce: boolean };
type DenoClientOptions = {
  user: string;
  password: string;
  hostname: string;
  port: string | number;
  database?: string;
  tls?: DenoTlsOptions;
  controls?: { decoders?: Record<number, (value: string) => unknown> };
};
type DenoPoolConstructor = new (
  options: DenoClientOptions,
  size: number
) => Pool;

/** node-postgres keeps type parsers in a PROCESS-GLOBAL registry, so this is
 *  registered once at module load rather than as a side effect of constructing a
 *  pool — a factory that reconfigures global state on every call is a trap for
 *  whoever calls it next. No-ops on Deno, whose driver takes per-pool decoders
 *  (see `controls` below) and exposes no `types` namespace. */
function registerNodeNumericParser(): void {
  (
    pg as unknown as {
      types?: {
        setTypeParser: (oid: number, fn: (v: string) => unknown) => void;
      };
    }
  ).types?.setTypeParser(NUMERIC_OID, Number);
}
registerNodeNumericParser();

export function getPostgresConnectionPool(connections: number): Pool {
  const cached = poolCache.get(connections);
  // An ended pool can never serve connections again ("Cannot use a pool after
  // calling end on the pool") — evict it so callers get a live pool instead of
  // a permanently broken process. `ending` is node-postgres only; on Deno it's
  // undefined and the cached pool is always reused.
  if (cached && !(cached as { ending?: boolean }).ending) return cached;

  const pool = createPostgresConnectionPool(connections);
  poolCache.set(connections, pool);
  return pool;
}

function createPostgresConnectionPool(connections: number): Pool {
  const runtime = getRuntime();

  switch (runtime) {
    case "deno": {
      // @ts-expect-error -- Deno global is only available in Deno runtime
      const url = Deno.env.get("SUPABASE_DB_URL")!;
      const connectionPoolerUrl = url.includes("supabase.co")
        ? url.replace("5432", "6543")
        : url;
      // deno-postgres accepts EITHER a URI string OR a ClientOptions object —
      // the NUMERIC decoder (`controls`) only fits on the object form, so
      // parse the URL ourselves. sslmode mapping mirrors the driver's own:
      // disable -> off; require/verify-* -> enforce; otherwise attempt TLS
      // and fall back (its default).
      const u = new URL(connectionPoolerUrl);
      const sslmode = u.searchParams.get("sslmode");
      const DenoPool = Pool as unknown as DenoPoolConstructor;
      const options: DenoClientOptions = {
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        hostname: u.hostname,
        port: u.port || 5432,
        database: u.pathname.replace(/^\//, "") || undefined,
        controls: {
          // The driver applies this element-wise to numeric[] via the base-type
          // fallback, so arrays decode too.
          decoders: { [NUMERIC_OID]: Number },
        },
      };
      if (sslmode) {
        options.tls = {
          enabled: sslmode !== "disable",
          enforce: ["require", "verify-ca", "verify-full"].includes(sslmode),
        };
      }
      return new DenoPool(options, connections);
    }
    case "node": {
      const url = process.env.SUPABASE_DB_URL!;
      const connectionPoolerUrl = url.includes("supabase.co")
        ? url.replace("5432", "6543")
        : url;
      const pool = new Pool({
        connectionString: connectionPoolerUrl,
        max: connections,
        // Fail fast instead of queueing forever when the DB/pooler is
        // unreachable or the pool is saturated.
        connectionTimeoutMillis: 10_000,
        // Rotate connections so direct (non-Supavisor) connections can't rot
        // through NAT/firewall idle limits.
        maxLifetimeSeconds: 1800,
      });
      // pg-pool purges the broken client before emitting 'error'; the listener
      // exists because an unlistened EventEmitter 'error' crashes the process.
      pool.on("error", (err) => {
        console.error("postgres pool: idle client error", err);
      });
      return pool;
    }

    default:
      throw new Error(
        "getPostgresConnectionPool is not supported in non-server environments"
      );
  }
}

interface PgDriverConstructor {
  new (config: PostgresDialectConfig): Driver;
}

export function getPostgresClient<D = KyselyDatabase>(
  pool: Pool,
  driver: PgDriverConstructor
): Kysely<D> {
  const runtime = getRuntime();

  switch (runtime) {
    case "node":
    case "deno": {
      return new Kysely<D>({
        dialect: {
          createAdapter() {
            return new PostgresAdapter();
          },
          createDriver() {
            return new driver({ pool });
          },
          createIntrospector(db: Kysely<unknown>) {
            return new PostgresIntrospector(db);
          },
          createQueryCompiler() {
            return new PostgresQueryCompiler();
          },
        },
      });
    }

    default:
      throw new Error(
        "getPostgresClient is not supported in non-server environments"
      );
  }
}
