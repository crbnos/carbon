// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { Task } from "@clack/prompts";
import { log } from "@clack/prompts";
import { execa } from "execa";
import { join } from "pathe";
import pg from "pg";
import { waitForPort, waitUntil } from "../helpers.js";
import { type DbTarget, dbUrl } from "../stack.js";
import type { StackHosts, StackMode } from "../topology.js";
import { readDevJwt } from "../worktree.js";
import { syncWorktreeCron } from "./shared-db.js";

// Block until each port accepts on 127.0.0.1. `onProgress` fires as each
// opens, so a stuck service (Inngest pulling its image) shows instead of a
// silent minute.
export async function waitForTcp(
  ports: number[],
  opts: { onProgress?: (line: string) => void } = {}
) {
  const total = ports.length;
  let opened = 0;
  await Promise.all(
    ports.map(async (p) => {
      await waitForPort(p, 60_000);
      opened += 1;
      opts.onProgress?.(`tcp:${p} open (${opened}/${total})`);
    })
  );
}

// Block until postgres accepts queries (TCP-open ≠ ready — init scripts run
// after the port opens).
export async function waitForPostgres(db: DbTarget, timeoutMs = 60_000) {
  const ready = () =>
    withClient(db, (c) => c.query("SELECT 1")).then(
      () => true,
      () => false
    );
  if (await waitUntil(ready, { timeoutMs, intervalMs: 1000 })) return;
  throw new Error(`postgres did not accept queries within ${timeoutMs}ms`);
}

// Block until Kong answers for both PostgREST and GoTrue. After a hibernated
// stack is started again the ports open well before these two can serve, and
// the request that woke the stack is waiting on exactly them.
export async function waitForApi(
  port: number,
  // The service key: the gateway serves bare /rest/v1/ (the OpenAPI document)
  // to the service role only, as the hosted platform does.
  serviceKey: string,
  timeoutMs = 60_000
) {
  const up = async (path: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { apikey: serviceKey },
        signal: AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const both = async () =>
    (await up("/rest/v1/")) && (await up("/auth/v1/health"));
  if (await waitUntil(both, { timeoutMs, intervalMs: 500 })) return;
  throw new Error(`the API did not answer within ${timeoutMs}ms`);
}

/**
 * Block until supabase storage-api has bootstrapped `storage.buckets`. Probes
 * for 30s first; if missing, invokes `onHeal` (re-apply init.sql + restart
 * dependent services) then polls again with a 150s budget.
 *
 * The heal path recovers worktrees whose pgdata volume predates the current
 * init.sql — Docker only runs init scripts on a fresh data dir, so role
 * passwords drift and storage-api auth-fails forever otherwise.
 */
export async function waitForStorageReady(
  db: DbTarget,
  opts: {
    onHeal?: () => Promise<void>;
    onProgress?: (line: string) => void;
    onTimeout?: () => Promise<void>;
  } = {}
) {
  const start = Date.now();
  const elapsed = () => Math.floor((Date.now() - start) / 1000);

  opts.onProgress?.("waiting for storage.buckets");
  if (await pollBuckets(db, start + 30_000)) {
    opts.onProgress?.(`storage.buckets ready (${elapsed()}s)`);
    return;
  }

  if (opts.onHeal) {
    opts.onProgress?.("storage stuck — running heal");
    await opts.onHeal();
  }

  if (await pollBuckets(db, start + 180_000)) {
    opts.onProgress?.(`storage.buckets ready (${elapsed()}s)`);
    return;
  }

  if (opts.onTimeout) {
    try {
      await opts.onTimeout();
    } catch {
      // diagnostics are best-effort; original error below is what matters
    }
  }
  throw new Error("storage.buckets did not appear within 180s");
}

// Re-apply `packages/dev/docker/init.sql` as the cluster superuser role.
// Docker's `docker-entrypoint-initdb.d` only runs on a fresh pgdata volume —
// a worktree with a pre-existing volume from before init.sql evolved keeps the
// old role passwords forever, so storage-api / gotrue / postgrest auth-fail on
// every boot. Re-applying is idempotent (`ALTER USER ... PASSWORD`, `CREATE
// SCHEMA IF NOT EXISTS`).
//
// Connect as `supabase_admin` (not `postgres`): current supabase/postgres
// images treat `supabase_admin` as a reserved role; only a superuser may
// `ALTER` it, and the host TCP `postgres` role is no longer sufficient.
export async function applyBootstrapSql(root: string, db: DbTarget) {
  const sql = readFileSync(join(root, "packages/dev/docker/init.sql"), "utf8");
  await withClient(db, (c) => c.query(sql), {
    user: "supabase_admin",
    password: "postgres"
  });
}

// --include-all: supabase bootstrap inserts a sentinel into schema_migrations
// that makes earlier-timestamp migrations look "out of order" without it.
// Returns `applied: true` when at least one migration ran — callers gate
// type/swagger regen on this so a re-run against an up-to-date DB stays cheap.
//
// Use `supabase_admin`, not `postgres`: current supabase/postgres images mark
// `session_authorization=postgres` as non-superuser (`is_superuser=off`), so
// the CLI cannot INSERT migration bookkeeping rows into
// `supabase_migrations.schema_migrations` as `postgres`.
async function applyMigrations(
  root: string,
  db: DbTarget
): Promise<{ applied: boolean }> {
  const args = [
    "migration",
    "up",
    "--include-all",
    "--db-url",
    dbUrl(db, "supabase_admin")
  ];
  const cwd = join(root, "packages/database");

  // Background services (PostgREST, Realtime) hold catalog locks that race
  // with CREATE POLICY / ALTER TABLE, so a deadlock is retried.
  const MAX_RETRIES = 3;
  const execOpts = { cwd, reject: false, preferLocal: true };
  // Inferred from the call so `r` is the string-encoded result (not execa's
  // buffer overload) and is definitely assigned after the loop.
  let r = await execa("supabase", args, execOpts);
  for (let attempt = 1; attempt < MAX_RETRIES && r.exitCode !== 0; attempt++) {
    const output = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
    if (!/deadlock detected/i.test(output)) break;
    log.warn(
      `deadlock during migration (attempt ${attempt}/${MAX_RETRIES}) — retrying in 3s`
    );
    await sleep(3000);
    r = await execa("supabase", args, execOpts);
  }
  if (r.exitCode !== 0) {
    const output = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
    // Auto-repair: DB has migration versions not present locally (stale from
    // another branch or incomplete volume wipe). Remove them and retry.
    if (/remote migration versions not found in local/i.test(output)) {
      const repaired = await repairStaleMigrations(root, db);
      if (repaired > 0) {
        log.warn(`repaired ${repaired} stale migration(s) — retrying`);
        const retry = await execa("supabase", args, {
          cwd,
          reject: false,
          preferLocal: true
        });
        if (retry.exitCode === 0) {
          return { applied: didApplyMigrations(retry) };
        }
        process.stderr.write(retry.stderr?.toString() ?? "");
        process.stdout.write(retry.stdout?.toString() ?? "");
        throw new Error(
          `supabase ${args.join(" ")} failed after repair (exit ${retry.exitCode})`
        );
      }
    }
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`supabase ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
  return { applied: didApplyMigrations(r) };
}

/**
 * The steps that bring a worktree database in line with this branch, in
 * order: migrations, the cron forwarding, the config row, generated types,
 * then the RLS policies. Every command that changes a database runs these.
 */
export function databaseTasks(
  stack: { root: string; db: DbTarget; mode: StackMode; hosts: StackHosts },
  opts: {
    migrate: boolean;
    regen: boolean;
    /** Swagger reads the running API, so only `crbn up` and a running stack have it. */
    swagger: boolean;
    /** Default: with `migrate`. A restore sets it: its database has the
     *  table whether it migrates or not, and `--mode prod` keeps the source's. */
    configRow?: boolean;
  }
): Task[] {
  const { root, db } = stack;
  let applied = false;
  return [
    {
      title: "Apply database migrations",
      enabled: opts.migrate,
      task: async () => {
        applied = (await applyMigrations(root, db)).applied;
        return applied ? "migrations applied" : "schema already up to date";
      }
    },
    {
      // Also when none applied: a restore loads cron.job with triggers off.
      title: "Forward the worktree's cron jobs",
      enabled: stack.mode === "shared",
      task: async () => {
        await syncWorktreeCron(db.database);
        return "cron jobs forwarded";
      }
    },
    {
      // Needs the "config" table, which a fresh database has only once
      // migrations ran.
      title: "Seed pg_net config row",
      enabled: opts.configRow ?? opts.migrate,
      task: async () => {
        await ensureConfigRow(db, readDevJwt().anonKey, stack.hosts);
        return "config row upserted";
      }
    },
    {
      title: opts.swagger ? "Regenerate types & swagger" : "Regenerate types",
      enabled: opts.regen,
      task: async () => {
        // Always: the checked-in types can lag a database that is already
        // migrated (a branch switch, a stash-pop, reverted generated files).
        await execa("pnpm", ["db:types"], { cwd: root });
        if (!opts.swagger || !applied) return "types refreshed";
        await execa("pnpm", ["generate:swagger"], { cwd: root });
        return "types + swagger refreshed";
      }
    },
    {
      title: "Sync RLS policies with the authz manifest",
      enabled: opts.migrate,
      task: () => syncAuthz(root, db)
    }
  ];
}

// Make every table's RLS policies match packages/database/src/authz/manifest.ts — the
// one place policies are authored; migrations only create tables. Callers run it after
// migrations (which create the tables) and after type regen, so a manifest problem
// fails loudly without leaving the generated types stale.
async function syncAuthz(root: string, db: DbTarget): Promise<string> {
  const r = await execa(
    "pnpm",
    ["--silent", "--filter", "@carbon/database", "run", "authz", "sync"],
    {
      cwd: root,
      reject: false,
      env: {
        ...process.env,
        SUPABASE_DB_URL: dbUrl(db, "supabase_admin"),
        // The pooler logs in as postgres; this connection is supabase_admin.
        SUPABASE_DB_POOLER_URL: ""
      }
    }
  );
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(
      "authz sync failed: fix the rule or function file named above (packages/database/src/authz, src/event-system/functions), then migrate again"
    );
  }
  const counts = (r.stdout ?? "").match(/changed \d+ (helper|table)\(s\)/g);
  return counts?.join(", ") ?? "policies in sync";
}

// supabase prints "Applying migration <ts>_<name>.sql..." per applied
// migration — on STDERR (stdout says "Local database is up to date." even
// while applying), so both streams must be checked.
function didApplyMigrations(r: { stdout?: string; stderr?: string }): boolean {
  return /Applying migration/i.test(`${r.stderr ?? ""}\n${r.stdout ?? ""}`);
}

// Find migration versions in DB that have no corresponding local file and
// remove them from supabase_migrations.schema_migrations.
async function repairStaleMigrations(
  root: string,
  db: DbTarget
): Promise<number> {
  const migrationsDir = join(root, "packages/database/supabase/migrations");
  const localVersions = new Set(
    readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0]!)
  );

  const remoteVersions = await withClient(
    db,
    async (c) => {
      const res = await c.query<{ version: string }>(
        "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
      );
      return res.rows.map((r) => r.version);
    },
    { user: "supabase_admin", password: "postgres" }
  );

  const stale = remoteVersions.filter((v) => !localVersions.has(v));
  if (stale.length === 0) return 0;

  await withClient(
    db,
    async (c) => {
      for (const version of stale) {
        await c.query(
          "DELETE FROM supabase_migrations.schema_migrations WHERE version = $1",
          [version]
        );
      }
    },
    { user: "supabase_admin", password: "postgres" }
  );

  return stale.length;
}

/**
 * Whether the Supabase service schemas are initialized, not just present.
 *
 * GoTrue and Storage build `auth`/`storage` through their OWN migrations, which
 * only run when those containers boot. A postgres-only stack leaves stubs — and
 * restoring a dump into that state silently no-ops the dump's `CREATE TABLE
 * auth.users` (the stub already exists), leaving a users table missing most of
 * its columns. `email_confirmed_at` is GoTrue's, so its presence proves GoTrue
 * migrated rather than that the table merely exists.
 *
 * Storage is checked separately rather than assumed from GoTrue: the restore
 * script guards its storage TRUNCATEs with `to_regclass` so a partially booted
 * stack can't abort the run, which means a missing `storage.objects` would let
 * the restore finish "successfully" with no buckets seeded. Both services must
 * have booted.
 *
 * Realtime is the third: `realtime.messages` is built by the Realtime service,
 * and Carbon's migrations put policies on it.
 */
export async function serviceSchemasReady(db: DbTarget): Promise<boolean> {
  return withClient(db, async (c) => {
    const r = await c.query(
      `SELECT to_regclass('auth.users') IS NOT NULL
                AND to_regclass('storage.objects') IS NOT NULL
                AND to_regclass('storage.buckets') IS NOT NULL
                AND to_regclass('realtime.messages') IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'auth' AND table_name = 'users'
                    AND column_name = 'email_confirmed_at'
                ) AS ready`
    );
    return r.rows[0]?.ready === true;
  });
}

// Carbon's migrations write into schemas GoTrue, Storage and Realtime build on
// their first boot, so a fresh volume can't be migrated until all three have.
export async function waitForServiceSchemas(db: DbTarget, timeoutMs = 90_000) {
  const ready = () => serviceSchemasReady(db).catch(() => false);
  if (await waitUntil(ready, { timeoutMs, intervalMs: 1000 })) return;
  throw new Error(
    `auth / storage / realtime schemas not ready within ${timeoutMs}ms — check the gotrue, storage and realtime containers`
  );
}

// The singleton "config" row (the API URL and anon key some database
// functions read), and the Vault `inngest_event_url` that
// util.send_inngest_event posts database events to. Without the URL the
// event-queue wake never fires in dev — and since webhooks ride the event
// system, they don't either. Both URLs are in-network (the API gateway,
// Inngest): pg_net requests leave from inside Docker, which can't reach host
// ports. `hosts` names the gateway and Inngest on that network: `kong` and
// `inngest` on a private stack, the worktree's aliases on the carbon-shared network.
async function ensureConfigRow(
  db: DbTarget,
  anonKey: string,
  hosts: { api: string; inngest: string }
): Promise<void> {
  await withClient(db, (c) =>
    c.query(
      `INSERT INTO "config" ("id", "apiUrl", "anonKey")
       VALUES (TRUE, $2, $1)
       ON CONFLICT ("id") DO UPDATE
         SET "apiUrl" = EXCLUDED."apiUrl", "anonKey" = EXCLUDED."anonKey"`,
      [anonKey, `http://${hosts.api}:8000`]
    )
  );
  await withClient(db, (c) =>
    c.query(`SELECT public.set_inngest_event_url($1)`, [
      `http://${hosts.inngest}:8288/e/NO_EVENT_KEY_SET`
    ])
  );
}

const SMOKE_TEST_EMAIL = "test@carbon.ms";
// The seed's second Admin (`devSecondAdminEmail` in @carbon/database), which
// the dev login's bypass accepts as an alias of DEV_BYPASS_EMAIL.
const SMOKE_TEST_SECOND_ADMIN_EMAIL = "test+admin2@carbon.ms";

/**
 * Seeds test@carbon.ms's company when the user is missing, and adds its second
 * Admin to a stack seeded before there was one (without touching its data).
 */
export async function ensureSmokeTestUser(
  root: string,
  db: DbTarget,
  apiPort: number
): Promise<{ seeded: "company" | "second admin" | null }> {
  const existing = await withClient(db, async (c) => {
    const r = await c.query<{ email: string }>(
      `SELECT email FROM "user" WHERE email = ANY($1)`,
      [[SMOKE_TEST_EMAIL, SMOKE_TEST_SECOND_ADMIN_EMAIL]]
    );
    return new Set(r.rows.map((row) => row.email));
  });

  const hasUser = existing.has(SMOKE_TEST_EMAIL);
  if (hasUser && existing.has(SMOKE_TEST_SECOND_ADMIN_EMAIL)) {
    return { seeded: null };
  }

  const supabaseUrl = `http://localhost:${apiPort}`;
  await execa(
    "pnpm",
    [
      "--filter",
      "@carbon/database",
      "run",
      hasUser ? "db:seed:dev:admin" : "db:seed:dev",
      "--",
      "--email",
      SMOKE_TEST_EMAIL
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        SUPABASE_DB_URL: dbUrl(db),
        SUPABASE_URL: supabaseUrl,
        NODE_TLS_REJECT_UNAUTHORIZED: "0"
      },
      stdio: "pipe"
    }
  );

  return { seeded: hasUser ? "second admin" : "company" };
}

type HostPgOpts = {
  user?: string;
  password?: string;
  database?: string;
};

// Host-side Postgres connection through `pg`, so no host `psql` is needed.
async function withClient<T>(
  db: DbTarget,
  fn: (c: pg.Client) => Promise<T>,
  opts: HostPgOpts = {}
): Promise<T> {
  const client = new pg.Client({
    host: "127.0.0.1",
    port: db.port,
    user: opts.user ?? "postgres",
    password: opts.password ?? "postgres",
    database: opts.database ?? db.database
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const pollBuckets = (db: DbTarget, deadline: number) =>
  waitUntil(() => storageBucketsExists(db), {
    timeoutMs: deadline - Date.now(),
    intervalMs: 1000
  });

async function storageBucketsExists(db: DbTarget): Promise<boolean> {
  try {
    return await withClient(db, async (c) => {
      const r = await c.query<{ regclass: string | null }>(
        "SELECT to_regclass('storage.buckets')::text AS regclass"
      );
      return r.rows[0]?.regclass === "storage.buckets";
    });
  } catch {
    return false;
  }
}
