/**
 * Drift check for the demo datasets.
 *
 * The tiers build their SQL from `information_schema` at runtime (`sql.ts`), so
 * nothing in the type system knows a dataset references a column — a migration
 * that drops one only breaks when somebody actually seeds. This runs the real
 * insert path to find that out.
 *
 * THIS FILE NEVER COMMITS. Each dataset gets a scratch company created inside a
 * transaction that is always rolled back, so the check is safe to point at a
 * developer's own database: on success, on failure, and on a killed process
 * (Postgres rolls back a dropped connection itself).
 */

import type { PoolClient } from "pg";
import { seedCompanyReferenceData } from "./bootstrap.ts";
import { applyDatasetTiers } from "./index.ts";
import { type Dataset, resolveCompanyTimeZone } from "./types.ts";

const SCRATCH_COMPANY_NAME = "Dataset Drift Check";

export type VerifyResult = {
  key: string;
  ok: boolean;
  error?: string;
  durationMs: number;
};

/** Postgres `undefined_table` — the database is behind on migrations. */
const UNDEFINED_TABLE = "42P01";

/**
 * The scratch company needs a real user id for its foreign keys. Prefer the
 * built-in `system` user so the check never attributes anything to a real
 * developer.
 *
 * Returns null when the check cannot run at all: no users yet, or no `user`
 * table because the database has not been migrated. Both are the developer's
 * environment, not dataset drift, so neither may fail a commit.
 */
export async function resolveCheckUserId(
  client: PoolClient
): Promise<string | null> {
  try {
    const system = await client.query<{ id: string }>(
      `SELECT id FROM "user" WHERE id = 'system'`
    );
    if (system.rows[0]) return system.rows[0].id;

    const any = await client.query<{ id: string }>(
      `SELECT id FROM "user" ORDER BY id LIMIT 1`
    );
    return any.rows[0]?.id ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) return null;
    throw err;
  }
}

/**
 * Apply one dataset to a throwaway company and roll the whole thing back.
 * Returns the failure rather than throwing it, so one broken dataset does not
 * hide the state of the other three.
 */
export async function verifyDataset(
  client: PoolClient,
  args: {
    dataset: Dataset;
    key: string;
    userId: string;
    log?: (message: string) => void;
  }
): Promise<VerifyResult> {
  const { dataset, key, userId, log } = args;
  const startedAt = performance.now();

  try {
    await client.query("BEGIN");
    // Set before the reference data too, so bootstrap's own triggers can't
    // dispatch events (pg_net calls would not roll back).
    await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);

    const { companyId } = await seedCompanyReferenceData(client, {
      userId,
      companyName: SCRATCH_COMPANY_NAME
    });
    const timeZone = await resolveCompanyTimeZone(client, companyId);

    await applyDatasetTiers(client, {
      companyId,
      userId,
      dataset,
      timeZone,
      log
    });

    return { key, ok: true, durationMs: performance.now() - startedAt };
  } catch (err) {
    return {
      key,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - startedAt
    };
  } finally {
    // The whole point of the exercise — on every path, including the throw.
    try {
      await client.query("ROLLBACK");
    } catch {}
  }
}
