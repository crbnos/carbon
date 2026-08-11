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
      // "pg" resolves to node-postgres types in the Node build, so cast the
      // deno-postgres (options, size) constructor shape explicitly.
      const DenoPool = Pool as unknown as new (
        options: unknown,
        size: number
      ) => Pool;
      return new DenoPool(
        {
          user: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
          hostname: decodeURIComponent(u.hostname),
          port: u.port || 5432,
          database: u.pathname.replace(/^\//, "") || undefined,
          ...(sslmode
            ? {
                tls: {
                  enabled: sslmode !== "disable",
                  enforce: ["require", "verify-ca", "verify-full"].includes(
                    sslmode
                  ),
                },
              }
            : {}),
          controls: {
            decoders: {
              // NUMERIC (OID 1700) arrives as text; decode to a JS number so
              // runtime values match the generated types. The driver applies
              // this element-wise to numeric[] via the base-type fallback.
              1700: (value: string) => Number(value),
            },
          },
        },
        connections
      );
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
      // node-postgres returns NUMERIC as text by default; parse to a JS number
      // so runtime values match the generated types (mirrors the Deno branch's
      // custom decoder). `types` only exists on node-postgres — on Deno the
      // namespace has no such export and this no-ops.
      (
        pg as unknown as {
          types?: {
            setTypeParser: (oid: number, fn: (v: string) => unknown) => void;
          };
        }
      ).types?.setTypeParser(1700, (v: string) => Number(v));
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
