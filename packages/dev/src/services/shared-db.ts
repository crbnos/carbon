// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The worktree database and Storage tenant in the shared containers
// (packages/dev/docker/docker-compose.shared.yml).
//
// carbon_template is the shared Postgres's `postgres` database right after the
// Supabase image built it, plus pg_cron and pg_net. A worktree database is a
// clone of it: under a second, and it inherits both extensions, so the
// migration's `CREATE EXTENSION IF NOT EXISTS pg_cron` is a no-op. Their
// workers serve only `postgres`; docker/worktree-forwarding.sql hands each
// clone's HTTP requests and cron jobs to them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pg from "pg";
import {
  SHARED_CONTAINERS,
  SHARED_DB_PORT,
  SHARED_STORAGE_ADMIN_PORT,
  SHARED_STORAGE_FILES
} from "../topology.js";
import { type JwtCreds, readDevJwt } from "../worktree.js";

const TEMPLATE = "carbon_template";
const FORWARDING_SQL = readFileSync(
  fileURLToPath(
    new URL("../../docker/worktree-forwarding.sql", import.meta.url)
  ),
  "utf8"
);
const DATABASE_NAME = /^wt_[a-z0-9_]{1,60}$/;

function checkName(database: string): void {
  if (!DATABASE_NAME.test(database)) {
    throw new Error(`not a worktree database name: ${database}`);
  }
}

export function createDatabaseSql(database: string): string {
  checkName(database);
  return `CREATE DATABASE "${database}" TEMPLATE ${TEMPLATE}`;
}

// A clone copies the template's contents but not pg_database's owner and ACL,
// so the clone would belong to supabase_admin with no grants. The Supabase CLI
// migrates as `postgres`, which is no superuser and needs CREATE. These match
// the image's own `postgres` database. Run on every `up`: idempotent.
export function databaseGrantsSql(database: string): string {
  checkName(database);
  const db = `"${database}"`;
  return [
    `ALTER DATABASE ${db} OWNER TO postgres`,
    `GRANT ALL ON DATABASE ${db} TO postgres`,
    `GRANT CREATE ON DATABASE ${db} TO supabase_etl_admin, supabase_storage_admin`,
    `GRANT ALL ON DATABASE ${db} TO dashboard_user`
  ].join(";\n");
}

export function dropDatabaseSql(database: string): string {
  checkName(database);
  return `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`;
}

async function asAdmin<T>(
  database: string,
  fn: (c: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({
    host: "127.0.0.1",
    port: SHARED_DB_PORT,
    user: "supabase_admin",
    password: "postgres",
    database
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const databaseExists = (c: pg.Client, name: string) =>
  c
    .query("SELECT 1 FROM pg_database WHERE datname = $1", [name])
    .then((r) => (r.rowCount ?? 0) > 0);

// Postgres can't clone a database that has connections, and the pg_cron
// launcher and the pg_net worker always hold 2 to `postgres`. So for one
// moment `postgres` takes no new connections, the 2 workers end (Postgres
// starts them again), and the clone runs. Only on a new volume.
async function ensureTemplate(): Promise<void> {
  if (await asAdmin("postgres", (c) => databaseExists(c, TEMPLATE))) return;
  await asAdmin("postgres", async (c) => {
    await c.query("CREATE EXTENSION IF NOT EXISTS pg_cron");
    await c.query("CREATE EXTENSION IF NOT EXISTS pg_net");
  });
  await asAdmin("template1", async (c) => {
    try {
      await c.query("ALTER DATABASE postgres ALLOW_CONNECTIONS false");
      await c.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres'"
      );
      await c.query(`CREATE DATABASE ${TEMPLATE} TEMPLATE postgres`);
    } catch (err) {
      // A second `crbn up` built it first.
      if ((err as { code?: string }).code !== "42P04") throw err;
    } finally {
      await c.query("ALTER DATABASE postgres ALLOW_CONNECTIONS true");
    }
    await c.query(
      `ALTER DATABASE ${TEMPLATE} IS_TEMPLATE true ALLOW_CONNECTIONS false`
    );
  });
}

/** A shared-mode worktree's data: its database, cloned from the template,
 *  and its Storage tenant. True when this call cloned the database. */
export async function provisionWorktreeData(
  database: string,
  jwt: JwtCreds
): Promise<boolean> {
  await ensureTemplate();
  const created = await createWorktreeDatabase(database);
  await registerStorageTenant(database, jwt);
  return created;
}

/** Creates the worktree database, and (again) its forwarding triggers.
 *  Returns false when the database already exists. */
async function createWorktreeDatabase(database: string): Promise<boolean> {
  const sql = createDatabaseSql(database);
  const grants = databaseGrantsSql(database);
  const created = await asAdmin("postgres", async (c) => {
    let created = false;
    if (!(await databaseExists(c, database))) {
      try {
        await c.query(sql);
        created = true;
      } catch (err) {
        if ((err as { code?: string }).code !== "42P04") throw err;
      }
    }
    await c.query(grants);
    return created;
  });
  await asAdmin(database, (c) =>
    c.query(
      `${FORWARDING_SQL};\nSELECT crbn.sync_cron(); SELECT crbn.flush_http()`
    )
  );
  return created;
}

// cron.unschedule deletes the job in C, where triggers don't fire, and a
// restore loads cron.job with triggers off. crbn runs this after each
// migration run and each restore.
export async function syncWorktreeCron(database: string): Promise<void> {
  checkName(database);
  await asAdmin(database, (c) => c.query("SELECT crbn.sync_cron()"));
}

async function dropWorktreeDatabase(database: string): Promise<void> {
  const sql = dropDatabaseSql(database);
  await asAdmin("postgres", async (c) => {
    await c.query(sql);
    // Its cron copies, and those of a database dropped by hand: pg_cron would
    // run them every time and fail.
    await c.query(
      `SELECT cron.unschedule(jobid) FROM cron.job
        WHERE jobname ~ '^wt_[^:]+:'
          AND database NOT IN (SELECT datname FROM pg_database)`
    );
  });
}

/** The `wt_` databases in the shared Postgres. */
export async function listWorktreeDatabases(): Promise<string[]> {
  return asAdmin("postgres", async (c) => {
    const r = await c.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname ~ '^wt_' ORDER BY 1"
    );
    return r.rows.map((row) => row.datname);
  });
}

const storageAdmin = (path: string) =>
  `http://127.0.0.1:${SHARED_STORAGE_ADMIN_PORT}${path}`;

// The tenant id is the database name. Storage connects as
// supabase_storage_admin, as the single-tenant stack does, and runs its own
// migrations in the tenant database when the tenant registers.
async function registerStorageTenant(
  database: string,
  jwt: JwtCreds
): Promise<void> {
  checkName(database);
  const init = (method: string) => ({
    method,
    headers: { apikey: jwt.serviceKey, "content-type": "application/json" },
    body: JSON.stringify({
      anonKey: jwt.anonKey,
      serviceKey: jwt.serviceKey,
      jwtSecret: jwt.secret,
      databaseUrl: `postgres://supabase_storage_admin:postgres@${SHARED_CONTAINERS.postgres}:5432/${database}`
    })
  });
  const created = await fetch(
    storageAdmin(`/tenants/${database}`),
    init("POST")
  );
  if (created.ok) return;
  // Registered before: update it, so a changed key pair reaches Storage.
  const updated = await fetch(
    storageAdmin(`/tenants/${database}`),
    init("PATCH")
  );
  if (!updated.ok) {
    throw new Error(
      `Storage tenant ${database}: POST ${created.status}, PATCH ${updated.status} ${await updated.text()}`
    );
  }
}

async function deleteStorageTenant(
  database: string,
  jwt: JwtCreds
): Promise<void> {
  checkName(database);
  const r = await fetch(storageAdmin(`/tenants/${database}`), {
    method: "DELETE",
    headers: { apikey: jwt.serviceKey }
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`Storage tenant ${database}: DELETE ${r.status}`);
  }
  // Storage keeps a tenant's files under <GLOBAL_S3_BUCKET>/<tenant>/.
  await execa("docker", [
    "exec",
    SHARED_CONTAINERS.storage,
    "rm",
    "-rf",
    `${SHARED_STORAGE_FILES}/${database}`
  ]);
}

/** Drops a shared-mode worktree's data: its database and Storage tenant.
 *  Throws when the shared containers are not reachable. */
export async function dropWorktreeData(database: string): Promise<void> {
  await deleteStorageTenant(database, readDevJwt());
  await dropWorktreeDatabase(database);
}

/** Connections to the shared Postgres, and the worktree's pg_net requests
 *  not handed to `postgres` (0 unless forwarding failed). */
export async function sharedStats(
  database: string
): Promise<{ connections: number; netQueue: number }> {
  const connections = await asAdmin("postgres", (c) =>
    c
      .query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity")
      .then((r) => r.rows[0]?.n ?? 0)
  );
  const netQueue = await asAdmin(database, (c) =>
    c
      .query<{ n: number }>(
        "SELECT count(*)::int AS n FROM net.http_request_queue"
      )
      .then((r) => r.rows[0]?.n ?? 0)
  );
  return { connections, netQueue };
}
