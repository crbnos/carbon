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
  if (cached) return cached;

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
      // @ts-ignore Compat
      return new Pool(connectionPoolerUrl, connections);
    }
    case "node": {
      const url = process.env.SUPABASE_DB_URL!;
      const connectionPoolerUrl = url.includes("supabase.co")
        ? url.replace("5432", "6543")
        : url;
      return new Pool({
        connectionString: connectionPoolerUrl,
        max: connections,
      });
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
