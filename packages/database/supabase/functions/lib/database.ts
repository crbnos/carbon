// Aliased it as pg so can be imported as-is in Node environment
import { Pool } from "pg";
import { PostgresDriver } from "./driver.ts";
import { getPostgresClient } from "./postgres/index.ts";
import type { Database as SupabaseDatabase } from "./types.ts";

type Tables = SupabaseDatabase["public"]["Tables"];
type Views = SupabaseDatabase["public"]["Views"];

export type DB = {
  [TableName in keyof Tables]: Tables[TableName]["Insert"];
} & {
  [ViewName in keyof Views]: Views[ViewName]["Row"];
};

export function getDatabaseClient<_>(pool: Pool) {
  return getPostgresClient(pool, PostgresDriver)
}
