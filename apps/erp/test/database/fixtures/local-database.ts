// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The local-database gate and connection shared by the live-database
// regressions (payments, memos, charges, reimbursements).
import {
  getPostgresClient,
  type KyselyDatabase
} from "@carbon/database/client";
import {
  type Kysely,
  PostgresDriver,
  type RawBuilder,
  sql,
  type Transaction
} from "kysely";
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

/** In CI (`CI` is set by the runner) the database exists for one job and is
 *  thrown away with it, so removing a test's rows buys nothing. A company
 *  delete cascades through hundreds of foreign keys and is most of a test's
 *  database time. */
const isDisposableDatabase = Boolean(process.env.CI);

/** Removes a test's rows in one transaction, or does nothing on a disposable
 *  database. It never closes `db`: the caller still destroys it. */
export async function removeTestRows(
  db: Kysely<KyselyDatabase>,
  remove: (trx: Transaction<KyselyDatabase>) => Promise<unknown>
): Promise<void> {
  if (isDisposableDatabase) return;
  await db.transaction().execute(remove);
}

/** A vitest case for a regression that requires the local database. */
export function databaseTest(
  name: string,
  fn: () => void | Promise<void>
): void {
  it.skipIf(!hasLocalDatabase)(name, fn, 60_000);
}

/** Fixture connections have trigger suppression on. An edit-lock test needs a
 * second connection because its advisory lock intentionally holds the first. */
export async function connectLocalTestDatabase({
  maxConnections = 1
}: { maxConnections?: number } = {}) {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl || !LOCAL_HOSTS.includes(new URL(databaseUrl).hostname)) {
    throw new Error("These regressions require a local SUPABASE_DB_URL");
  }
  // One connection: requests in the real seam share it, so they inherit the
  // trigger suppression even when they open a new transaction.
  const db = getPostgresClient<KyselyDatabase>(
    new Pool({
      connectionString: databaseUrl,
      max: maxConnections,
      // The startup option applies to every connection in a larger pool.
      ...(maxConnections > 1
        ? { options: "-c app.sync_in_progress=true" }
        : {})
    }),
    PostgresDriver
  );
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
    db
  );
  return db;
}

/**
 * Runs `fn` with `db`'s writes to `table` refused where `refused` holds, so a
 * test can fail an operation part-way through. A temporary view named after
 * the table shadows it on this connection only (pg_temp is searched before
 * public), and its CHECK OPTION refuses the row with SQLSTATE 44000. A trigger
 * would need to own the table, which the test role does not, and its DDL
 * locks the table against every other test running at the same time.
 * `refused` is written into the view, which takes no bind parameters: build
 * its values with `sql.lit`. Rows it matches are also hidden from reads.
 */
export async function withRefusedWrites<T>(
  db: Kysely<KyselyDatabase>,
  table: keyof KyselyDatabase & string,
  refused: RawBuilder<unknown>,
  fn: () => Promise<T>
): Promise<T> {
  await sql`CREATE TEMP VIEW ${sql.id(table)} AS SELECT * FROM public.${sql.id(table)} WHERE (${refused}) IS NOT TRUE WITH CHECK OPTION`.execute(
    db
  );
  try {
    return await fn();
  } finally {
    await sql`DROP VIEW pg_temp.${sql.id(table)}`.execute(db);
  }
}
