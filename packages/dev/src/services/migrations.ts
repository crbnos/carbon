import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";
import { join } from "pathe";
import pg from "pg";
import { waitForPort } from "../helpers.js";

// ---------------------------------------------------------------------------
// Readiness gates
// ---------------------------------------------------------------------------

// Block until each tcp:<port> accepts on 127.0.0.1. `onProgress` fires once
// per port as it opens — caller streams these into a spinner subtitle so a
// stuck service (e.g. inngest pulling its container) is visible instead of a
// 60s silent hang.
export async function waitForTcp(
  targets: string[],
  opts: { onProgress?: (line: string) => void } = {}
) {
  const ports = targets.map((t) => {
    const m = t.match(/^tcp:(\d+)$/);
    if (!m)
      throw new Error(`waitForTcp: bad target "${t}" (expected tcp:<port>)`);
    return Number(m[1]);
  });
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
export async function waitForPostgres(port: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await withClient(port, (c) => c.query("SELECT 1"));
      return;
    } catch {
      // postgres still initializing — retry until deadline
    }
    await sleep(1000);
  }
  throw new Error(`postgres did not accept queries within ${timeoutMs}ms`);
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
  port: number,
  opts: {
    onHeal?: () => Promise<void>;
    onProgress?: (line: string) => void;
    onTimeout?: () => Promise<void>;
  } = {}
) {
  const start = Date.now();
  const elapsed = () => Math.floor((Date.now() - start) / 1000);

  opts.onProgress?.("waiting for storage.buckets");
  if (await pollBuckets(port, start + 30_000)) {
    opts.onProgress?.(`storage.buckets ready (${elapsed()}s)`);
    return;
  }

  if (opts.onHeal) {
    opts.onProgress?.("storage stuck — running heal");
    await opts.onHeal();
  }

  if (await pollBuckets(port, start + 180_000)) {
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
export async function applyBootstrapSql(root: string, port: number) {
  const sql = readFileSync(join(root, "packages/dev/docker/init.sql"), "utf8");
  await withClient(port, (c) => c.query(sql), {
    user: "supabase_admin",
    password: "postgres"
  });
}

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

// --include-all: supabase bootstrap inserts a sentinel into schema_migrations
// that makes earlier-timestamp migrations look "out of order" without it.
// Returns `applied: true` when at least one migration ran — callers gate
// type/swagger regen on this so a re-run against an up-to-date DB stays cheap.
//
// Use `supabase_admin`, not `postgres`: current supabase/postgres images mark
// `session_authorization=postgres` as non-superuser (`is_superuser=off`), so
// the CLI cannot INSERT migration bookkeeping rows into
// `supabase_migrations.schema_migrations` as `postgres`.
export async function applyMigrations(
  root: string,
  dbPort: number
): Promise<{ applied: boolean }> {
  const args = [
    "migration",
    "up",
    "--include-all",
    "--db-url",
    `postgresql://supabase_admin:postgres@localhost:${dbPort}/postgres`
  ];
  const cwd = join(root, "packages/database");
  const r = await execa("supabase", args, {
    cwd,
    reject: false,
    preferLocal: true
  });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`supabase ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
  // supabase prints "Applying migration <ts>_<name>.sql..." per applied
  // migration; absent that, the schema was already current.
  const applied = /Applying migration/i.test(r.stdout ?? "");
  return { applied };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

type HostPgOpts = {
  user?: string;
  password?: string;
  database?: string;
};

// Host-side Postgres connection. `pg` avoids a host `psql` install —
// previously a hidden requirement that bit at least one engineer.
async function withClient<T>(
  port: number,
  fn: (c: pg.Client) => Promise<T>,
  opts: HostPgOpts = {}
): Promise<T> {
  const client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: opts.user ?? "postgres",
    password: opts.password ?? "postgres",
    database: opts.database ?? "postgres"
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function pollBuckets(port: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await storageBucketsExists(port)) return true;
    await sleep(1000);
  }
  return false;
}

async function storageBucketsExists(port: number): Promise<boolean> {
  try {
    return await withClient(port, async (c) => {
      const r = await c.query<{ regclass: string | null }>(
        "SELECT to_regclass('storage.buckets')::text AS regclass"
      );
      return r.rows[0]?.regclass === "storage.buckets";
    });
  } catch {
    return false;
  }
}
