/**
 * Checks that the demo datasets still apply against the current schema.
 *
 * Each dataset is applied to a throwaway company inside a transaction that is
 * always rolled back, so this writes NOTHING — it is safe to run against your
 * own development database. See `datasets/verify.ts` for the guarantee.
 *
 * Runs from the pre-commit hook when `packages/database/**` is touched; set
 * CARBON_SKIP_DATASET_CHECK=1 to skip it there.
 *
 * Usage:
 *   pnpm db:check:datasets                       # every dataset
 *   pnpm db:check:datasets -- --dataset motor    # one (repeatable)
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { PoolClient } from "pg";
import { getPostgresConnectionPool } from "./client.ts";
import { loadEnv } from "./datasets/cli.ts";
import { datasetKeys, getDataset } from "./datasets/index.ts";
import { validateDataset } from "./datasets/validate.ts";
import { resolveCheckUserId, verifyDataset } from "./datasets/verify.ts";

loadEnv();

function printUsage(keys: string[]) {
  console.log(`
Usage: pnpm db:check:datasets [-- --dataset <key>]

Applies each demo dataset to a throwaway company and rolls it back, so schema
drift surfaces without writing anything to your database.

Arguments:
  --dataset   Which dataset to check; repeat for several.
              Default: all (${keys.join(", ")})
`);
}

/** Environmental problems must not fail the check — a hook that fails for
 *  reasons you can't fix is a hook you learn to bypass. */
function skip(reason: string): never {
  console.log(`⚠ Dataset drift check skipped — ${reason}`);
  process.exit(0);
}

/**
 * A stale database fails the check for a column that DOES exist on `main`, so
 * without this the failure tells you to go fix the datasets when the real fix
 * is `pnpm db:migrate`. Returns 0 when the count can't be established — this
 * only ever adds a hint, so guessing wrong must never change the verdict.
 */
async function countPendingMigrations(client: PoolClient): Promise<number> {
  try {
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "supabase",
      "migrations"
    );
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0] ?? "");

    const applied = await client.query<{ version: string }>(
      `SELECT version FROM supabase_migrations.schema_migrations`
    );
    const seen = new Set(applied.rows.map((r) => r.version));
    return onDisk.filter((v) => !seen.has(v)).length;
  } catch {
    return 0;
  }
}

async function main() {
  const keys = datasetKeys();
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      dataset: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false }
    },
    strict: true
  });

  if (values.help) {
    printUsage(keys);
    return;
  }

  const selected = values.dataset?.length ? values.dataset : keys;
  for (const key of selected) {
    if (!getDataset(key)) {
      console.error(`No such dataset: ${key}. Available: ${keys.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  // Pure validation first: it needs no database, so a broken dataset blocks the
  // commit even when the DB layer below skips.
  let inconsistent = false;
  for (const key of selected) {
    const violations = validateDataset(getDataset(key)!);
    if (violations.length > 0) {
      inconsistent = true;
      console.error(
        `  ✗ ${key} — ${violations.length} consistency violation(s):`
      );
      for (const violation of violations) console.error(`      ${violation}`);
    }
  }
  if (inconsistent) {
    console.error(
      `\nThe demo datasets are internally inconsistent. Fix them in packages/database/src/datasets/data/ before committing.`
    );
    console.error(
      `Re-run on its own with: pnpm db:check:datasets\nCommit anyway with:     CARBON_SKIP_DATASET_CHECK=1 git commit ...`
    );
    process.exitCode = 1;
    return;
  }

  // No connection string configured at all (fresh worktree, no .env.local).
  // getPostgresConnectionPool dereferences it before any connect() can fail,
  // so without this the hook blocks the commit on "Cannot read properties of
  // undefined (reading 'includes')" — the least actionable message there is.
  if (!process.env.SUPABASE_DB_URL) {
    skip("SUPABASE_DB_URL is not set (no .env.local in this worktree?)");
  }

  const pool = getPostgresConnectionPool(1);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    await pool.end().catch(() => {});
    skip(
      `no database connection (is your local stack up?)\n  ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  try {
    const userId = await resolveCheckUserId(client);
    if (!userId) skip("this database has no users yet (migrations applied?)");

    console.log(`Checking ${selected.length} dataset(s) against the schema...`);
    let failed = false;
    for (const key of selected) {
      // Buffer tier logs and surface them only on failure — they place the
      // error inside the tier sequence without drowning a green run.
      const tierLog: string[] = [];
      const result = await verifyDataset(client, {
        dataset: getDataset(key)!,
        key,
        userId,
        log: (message) => tierLog.push(message)
      });
      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.ok) {
        console.log(`  ✓ ${key} (${seconds}s)`);
      } else {
        failed = true;
        console.error(`  ✗ ${key} (${seconds}s) — ${result.error}`);
        const tail = tierLog.slice(-12);
        if (tail.length > 0) {
          console.error(`    last tier steps:`);
          for (const line of tail) console.error(`      ${line}`);
        }
      }
    }

    if (failed) {
      const pending = await countPendingMigrations(client);
      console.error(
        pending > 0
          ? `\nYour database is ${pending} migration(s) behind, so this may not be dataset drift at all — run pnpm db:migrate and check again before changing anything.`
          : `\nThe demo datasets no longer match the schema, or a table fell below its row-count floor (datasets/coverage.ts). Fix them in packages/database/src/datasets/ — onboarding's demo templates and pnpm db:seed:dev both run this code.`
      );
      console.error(
        `Re-run on its own with: pnpm db:check:datasets\nCommit anyway with:     CARBON_SKIP_DATASET_CHECK=1 git commit ...`
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\nError checking datasets:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
