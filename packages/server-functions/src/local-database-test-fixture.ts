// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The local-database gate and connection shared by the live-database
// regressions (payments, memos, charges, reimbursements).
import {
  getPostgresClient,
  type KyselyDatabase
} from "@carbon/database/client";
import { PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { it } from "vitest";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Is an existing LOCAL database configured?
 *
 *  These regressions exercise real transactions, row locks and concurrency, so
 *  they cannot be faked against a mock. Without a database they SKIP rather than
 *  fail: a failure on a clean checkout just trains people to ignore the suite. */
export const hasLocalDatabase: boolean = (() => {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) return false;
  try {
    return LOCAL_HOSTS.includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
})();

/** A vitest case for a regression that requires the local database. */
export function databaseTest(
  name: string,
  fn: () => void | Promise<void>
): void {
  it.skipIf(!hasLocalDatabase)(name, fn, 60_000);
}

/** One connection with trigger suppression on, as the fixtures' inserts need. */
export async function connectLocalTestDatabase() {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl || !LOCAL_HOSTS.includes(new URL(databaseUrl).hostname)) {
    throw new Error("These regressions require a local SUPABASE_DB_URL");
  }
  // One connection: requests in the real seam share it, so they inherit the
  // trigger suppression even when they open a new transaction.
  const db = getPostgresClient<KyselyDatabase>(
    new Pool({ connectionString: databaseUrl, max: 1 }),
    PostgresDriver
  );
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
    db
  );
  return db;
}
