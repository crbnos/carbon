/**
 * Checks that the backups customers already hold would still restore against the
 * current schema.
 *
 * A migration can make an existing backup unrestorable without the backup changing
 * at all — add a NOT NULL column with no DEFAULT and every backup taken before today
 * stops loading. Nobody finds out until someone clicks Restore, which is the worst
 * possible moment. So the question gets asked here, at commit time.
 *
 * The baseline is `packages/jobs/manifests/schema.json` AS IT STANDS ON `main` —
 * the schema real customer backups were taken against. The copy in the working tree
 * is not the baseline: it is regenerated from the live database on every successful
 * `--stage` run, so comparing against it would compare today with today.
 *
 * Runs from the pre-commit hook when `packages/database/supabase/migrations/**` is
 * touched; set CARBON_SKIP_BACKUP_CHECK=1 to skip it there.
 *
 * Usage:
 *   pnpm db:check:backups             # check only — writes nothing
 *   pnpm db:check:backups -- --stage  # ...then update and stage schema.json
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import type { KyselyDatabase } from "@carbon/database/client";
import { now } from "@internationalized/date";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Catalog, Manifest } from "../backups/schema";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  exportableColumns,
  getCompanyTableCatalog,
  reportBackupCompatibility,
  selectExportableTables
} from "../backups/schema";
import {
  BASELINE_BRANCH,
  BaselineError,
  resolveBaseline,
  SCHEMA_REPO_PATH
} from "./backup-baseline";

const SCHEMA_FILE = join(import.meta.dirname, "../../manifests/schema.json");
/** A hook that hangs is a hook people bypass. */
const FETCH_TIMEOUT_MS = 3000;

const FIX_HINT =
  "Fix: give the new column a DEFAULT (or make it nullable and backfill), or — " +
  "if a table was renamed — add an entry to TABLE_RENAMES in " +
  "packages/jobs/src/backups/renames.ts";

const RERUN_HINT =
  "Re-run on its own with: pnpm db:check:backups\n" +
  "Commit anyway with:     CARBON_SKIP_BACKUP_CHECK=1 git commit ...";

/**
 * A Kysely client built here rather than borrowed from `src/db.ts`.
 *
 * `getJobDatabaseClient` named-imports `@carbon/database/client`, which resolves as
 * CJS from this package's ESM — fine under Vite and vitest, a hard `SyntaxError`
 * under plain `tsx`. Owning the pool is also what lets this script close it and exit.
 */
function connect(): { db: Kysely<KyselyDatabase>; pool: pg.Pool } {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    skip("SUPABASE_DB_URL is not set (is your local stack up?)");
  }
  const pool = new pg.Pool({ connectionString, max: 1 });
  return {
    db: new Kysely<KyselyDatabase>({ dialect: new PostgresDialect({ pool }) }),
    pool
  };
}

/** Environmental problems must not fail the check — a hook that fails for reasons
 *  you can't fix is a hook you learn to bypass. */
function skip(reason: string): never {
  console.log(`⚠ Backup compatibility check skipped — ${reason}`);
  process.exit(0);
}

/** A missing baseline is NOT environmental — see `resolveBaseline`. */
function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * How many migrations exist on disk but have not been applied here.
 *
 * This is the one place this check diverges from `check-datasets.ts`, which uses the
 * same count only as a hint when something already failed. Here an unapplied
 * migration is a FALSE PASS: the live schema does not yet contain the change being
 * committed, so the baseline looks fine. Refusing to give a verdict is the only
 * honest option, so a count that cannot be established returns -1 and also refuses.
 */
async function countPendingMigrations(
  db: Kysely<KyselyDatabase>
): Promise<number> {
  try {
    const dir = join(
      import.meta.dirname,
      "../../../database/supabase/migrations"
    );
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0] ?? "");

    const applied = await sql<{ version: string }>`
      SELECT version FROM supabase_migrations.schema_migrations
    `.execute(db);
    const seen = new Set(applied.rows.map((r) => r.version));
    return onDisk.filter((v) => !seen.has(v)).length;
  } catch {
    return -1;
  }
}

/**
 * A manifest describing a schema rather than a backup: every exportable table with
 * its column list and no rows.
 *
 * Which tables and columns those are is `selectExportableTables` /
 * `exportableColumns` — the exporter's own rule, not a copy of it. That is the whole
 * reason this file can stand in for a customer's backup.
 */
function catalogAsManifest(catalog: Catalog, exportedAt: string): Manifest {
  const { exportable, excludedTables } = selectExportableTables(catalog);
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    schemaVersion: catalog.schemaVersion,
    sourceCompanyId: "schema-baseline",
    sourceCompanyGroupId: null,
    sourceCompanyName: null,
    exportedAt,
    exportedBy: "schema-baseline",
    label: "schema baseline",
    includeStorage: "none",
    tables: exportable.map((t) => ({
      name: t.name,
      rows: 0,
      columns: exportableColumns(t).map((c) => c.name)
    })),
    storage: [],
    excludedTables
  };
}

/** Print the blocking findings; returns whether any were found. */
function reportBlocking(
  label: string,
  catalog: Catalog,
  manifest: Manifest
): boolean {
  const { findings, blocked } = reportBackupCompatibility(catalog, manifest);
  if (!blocked) {
    console.log(`  ✓ ${label}: restorable`);
    return false;
  }
  const blocking = findings.filter((f) => f.kind === "blocked");
  console.error(`  ✗ ${label}: ${blocking.length} blocking change(s)`);
  for (const f of blocking) {
    console.error(
      `      ${f.table}${f.column ? `.${f.column}` : ""} — ${f.reason}`
    );
  }
  return true;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

/** The I/O `resolveBaseline` needs, kept here so the decision itself stays pure. */
const baselineSources = {
  remoteUrl: () => {
    try {
      return git(["remote", "get-url", "origin"]);
    } catch {
      return null;
    }
  },
  fetchText: async (url: string) => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },
  localText: () => {
    try {
      return git(["show", `origin/${BASELINE_BRANCH}:${SCHEMA_REPO_PATH}`]);
    } catch {
      return null;
    }
  }
};

/** Generated output, like a lockfile — announced, never silent. */
function writeSchemaFile(catalog: Catalog): void {
  // @internationalized/date, never JS Date (.claude/rules/date-handling.md), and UTC
  // rather than the machine's zone — this stamp labels a schema, not a business day.
  const manifest = catalogAsManifest(catalog, now("UTC").toAbsoluteString());
  mkdirSync(dirname(SCHEMA_FILE), { recursive: true });
  writeFileSync(SCHEMA_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    git(["add", SCHEMA_FILE]);
    console.log(
      `Updated and staged ${SCHEMA_REPO_PATH} (${manifest.tables.length} tables) — the baseline the next migration is checked against.`
    );
  } catch (err) {
    console.warn(
      `⚠ Wrote ${SCHEMA_REPO_PATH} but could not stage it — ${
        err instanceof Error ? err.message : String(err)
      }\n  Run: git add ${SCHEMA_REPO_PATH}`
    );
  }
}

function printUsage() {
  console.log(`
Usage: pnpm db:check:backups [-- --stage]

Asks whether the backups customers already hold would still restore against your
current schema, comparing packages/jobs/manifests/schema.json AS IT STANDS ON main
with your live schema. Writes nothing to your database.

Arguments:
  --stage   On success, regenerate schema.json from your live schema and git-add
            it. The pre-commit hook passes this; a manual run stays read-only.
`);
}

async function main(db: Kysely<KyselyDatabase>) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      stage: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    },
    strict: true
  });

  if (values.help) {
    printUsage();
    return;
  }

  // Probed separately from the queries below so a stack that isn't up reads as
  // "skipped", not as a failed check the developer is expected to act on.
  try {
    await sql`SELECT 1`.execute(db);
  } catch (err) {
    skip(
      `no database connection (is your local stack up?)\n  ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Meaningless against a stale database: checking gives a false pass, and staging
  // records a baseline missing the very change being committed — which then becomes
  // what everything after it is judged by.
  const pending = await countPendingMigrations(db);
  if (pending !== 0) {
    skip(
      pending < 0
        ? "the applied-migration list could not be read (is this a Carbon database?)"
        : `your database is ${pending} migration(s) behind, so it cannot see the change you are committing.\n  Run pnpm db:migrate and try again.`
    );
  }

  const catalog = await getCompanyTableCatalog(db);

  const baseline = await resolveBaseline(baselineSources);
  for (const warning of baseline.warnings) console.warn(warning);
  console.log(`Checking your schema against ${baseline.source}...`);

  if (reportBlocking(SCHEMA_REPO_PATH, catalog, baseline.manifest)) {
    console.error(
      `\nBackups taken against ${baseline.source} would no longer restore.\n${FIX_HINT}\n\n${RERUN_HINT}`
    );
    // A blocked commit stages nothing: the baseline must keep describing the schema
    // that is actually shipped.
    process.exitCode = 1;
    return;
  }

  if (values.stage) writeSchemaFile(catalog);
}

const { db, pool } = connect();
main(db)
  .catch((err) => {
    if (err instanceof BaselineError) fail(err.message);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Without this the pool keeps the event loop alive and the script never exits.
    await db.destroy().catch(() => pool.end());
  });
