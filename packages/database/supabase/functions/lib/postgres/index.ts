import {
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresDialectConfig,
  PostgresIntrospector,
  PostgresQueryCompiler,
  Transaction
} from "kysely";
import type { KyselifyDatabase } from "kysely-supabase";
// Aliased it as pg so can be imported as-is in Node environment
import { Pool } from "pg";
import type { Database as SupabaseDatabase } from "../types.ts";

export type KyselyDatabase = KyselifyDatabase<SupabaseDatabase>;
export type KyselyTx = Transaction<KyselyDatabase>;

export function getRuntime() {
  if (typeof globalThis.Deno !== "undefined") {
    return "deno";
  }

  if (typeof window !== "undefined") {
    return "browser";
  }

  return "node";
}

export function getPostgresConnectionPool(connections: number) {
  const runtime = getRuntime();

  switch (runtime) {
    case "deno": {
      const url = Deno.env.get("SUPABASE_DB_URL")!;
      const connectionPoolerUrl = url.includes("supabase.co")
        ? url.replace("5432", "6543")
        : url;
      return new Pool(connectionPoolerUrl, connections);
    }
    case "node": {
      // @ts-expect-error process.env is not available in Deno with ESM
      const url = process.env.SUPABASE_DB_URL! ?? import.meta.env.SUPABASE_DB_URL;
      const connectionPoolerUrl = url.includes("supabase.co")
        ? url.replace("5432", "6543")
        : url;
      // @ts-expect-error -- Kysely uses a subset of the pg Pool type
      return new Pool({
        connectionString: connectionPoolerUrl,
        max: connections
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

export function getPostgresClient(pool: Pool, driver: PgDriverConstructor) {
  const runtime = getRuntime();

  switch (runtime) {
    case "node":
    case "deno": {
      return new Kysely<KyselyDatabase>({
        dialect: {
          createAdapter() {
            return new PostgresAdapter();
          },
          createDriver() {
            // @ts-ignore -- Kysely uses a subset of the pg Pool type
            return new driver({ pool });
          },
          createIntrospector(db: Kysely<unknown>) {
            return new PostgresIntrospector(db);
          },
          createQueryCompiler() {
            return new PostgresQueryCompiler();
          }
        }
      });
    }

    default:
      throw new Error(
        "getPostgresClient is not supported in non-server environments"
      );
  }
}