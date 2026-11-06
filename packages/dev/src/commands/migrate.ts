// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { intro, log, outro } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { execa } from "execa";
import { join } from "pathe";
import { renderEnv, syncAppPortlessConfigs, writeEnv } from "../env.js";
import { currentBranch } from "../git.js";
import { onShutdown, requireNumberEnv, tryConnect } from "../helpers.js";
import {
  bootSharedServices,
  bootStack,
  ensureDockerRunning,
  ensureSharedNetwork,
  stopStack
} from "../services/compose.js";
import { wakeIfAsleep } from "../services/hibernate.js";
import {
  applyMigrations,
  type DbTarget,
  ensureConfigRow,
  modeOf,
  serviceSchemasReady,
  stackHosts,
  syncAuthz,
  waitForPostgres,
  waitForServiceSchemas,
  worktreeDbTarget
} from "../services/migrations.js";
import { branchToPrefix } from "../services/portless.js";
import {
  createWorktreeDatabase,
  registerStorageTenant
} from "../services/shared-db.js";
import { tasks } from "../ui.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  readDevJwt,
  recordedStackMode,
  resolveSlot,
  resolveSlug,
  type StackMode,
  worktreeDatabaseName,
  writeStackMode
} from "../worktree.js";

// Shared mode runs Postgres and Storage in crbn-shared, so only the 2 services
// that build their schemas in the worktree database boot here.
const MIGRATION_SERVICES: Record<StackMode, string[]> = {
  isolated: ["postgres", "gotrue", "storage", "realtime"],
  shared: ["gotrue", "realtime"]
};

// Run database migrations against the worktree's local stack. If postgres is
// already running (full stack up), migrate against it directly. If not, boot
// postgres plus the three services whose schemas the migrations write into,
// apply migrations + regenerate types, then tear down — no need for the full
// compose stack to run migrations.
export async function migrate(opts: { regen?: boolean } = {}) {
  const shouldRegen = opts.regen ?? true;
  intro("Carbon · dev migrate");

  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const envLocal = join(root, ".env.local");

  // Load .env.local if it exists (written by a prior `crbn up`).
  if (existsSync(envLocal)) {
    loadDotenv({ path: envLocal, override: true });
  }
  loadDotenv({ path: join(root, ".env"), override: false });

  let portDb: number | undefined;
  try {
    portDb = requireNumberEnv("PORT_DB");
  } catch {
    // .env.local missing or PORT_DB not set — will need to provision.
  }

  if (await wakeIfAsleep(slug)) log.info("woke the hibernated stack");

  // If postgres is already reachable, migrate against the running DB.
  if (portDb && (await tryConnect("127.0.0.1", portDb, 500))) {
    const db = worktreeDbTarget(slug, portDb);
    const mode = modeOf(db);
    // An older crbn wrote no mode: record the one its .env.local runs, so the
    // compose files match the stack.
    if (recordedStackMode(slug) === null) writeStackMode(slug, mode);
    const running = () =>
      migrateAgainstRunningDb(root, db, stackHosts(mode, slug), shouldRegen);
    if (mode === "isolated") return running();
    // The shared Postgres is up for every worktree. This worktree's stack is
    // up when its gateway answers: then wait for it, never boot or stop it.
    const portApi = Number(process.env.PORT_API);
    if (portApi && (await tryConnect("127.0.0.1", portApi, 500))) {
      await waitForServiceSchemas(db);
      return running();
    }
    // Stack down, but GoTrue and Realtime built their schemas before.
    if (await serviceSchemasReady(db).catch(() => false)) return running();
  }

  // Standalone mode: boot the migration services, migrate, tear down.
  return migrateStandalone(root, slug, shouldRegen);
}

// ─── Running-stack path (existing behavior) ──────────────────────────────

async function migrateAgainstRunningDb(
  root: string,
  db: DbTarget,
  hosts: { api: string; inngest: string },
  shouldRegen: boolean
) {
  let applied = false;
  await tasks([
    {
      title: "Apply database migrations",
      task: async () => {
        const r = await applyMigrations(root, db);
        applied = r.applied;
        return r.applied ? "migrations applied" : "schema already up to date";
      }
    },
    {
      title: "Seed pg_net config row",
      task: async () => {
        const anonKey = process.env.SUPABASE_ANON_KEY;
        if (!anonKey) return "skipped (SUPABASE_ANON_KEY not set)";
        await ensureConfigRow(db, anonKey, hosts);
        return "config row upserted";
      }
    },
    ...(shouldRegen
      ? [
          {
            title: "Regenerate types & swagger",
            task: async () => {
              // Always regenerate types: the on-disk types must match the DB
              // schema, and that can be out of sync even when no NEW migration
              // ran this invocation — schema already applied after a branch
              // switch, a stash-pop, a conflict resolved by keeping the old
              // types, or a prior run whose generated files were reverted.
              // Gating this on `applied` left stale types in exactly those
              // cases (the DB is up to date but the checked-in types are not).
              await execa("pnpm", ["db:types"], { cwd: root });
              // Swagger only changes when the schema changed and is heavier, so
              // keep it gated on a migration having actually applied.
              if (applied) {
                await execa("pnpm", ["generate:swagger"], { cwd: root });
                return "types + swagger refreshed";
              }
              return "types refreshed";
            }
          }
        ]
      : []),
    {
      title: "Sync RLS policies with the authz manifest",
      task: () => syncAuthz(root, db)
    }
  ]);
  outro("done");
}

// ─── Standalone path (migration services only) ────────────────────────────

async function migrateStandalone(
  root: string,
  slug: string,
  shouldRegen: boolean
) {
  const envLocal = join(root, ".env.local");

  // Provision slot if .env.local doesn't exist yet (first time in this
  // worktree). Reuses the registry so the next `crbn up` gets the same
  // ports/JWT/volumes.
  if (!existsSync(envLocal)) {
    log.info("provisioning worktree slot (first run)");
    await ensureDockerRunning();
    await ensureSlugAvailable(slug, root);
    persistSlug(root, slug);

    const slot = await resolveSlot(slug, root);
    const branch = await currentBranch(root);
    const branchPrefix = branchToPrefix(branch, slug);
    // No `crbn up` ran here yet: take its default mode.
    writeStackMode(slug, "shared");
    writeEnv(
      root,
      renderEnv({
        slug,
        portless: true,
        branchPrefix,
        ...slot,
        mode: "shared",
        database: worktreeDatabaseName(slug)
      })
    );
    syncAppPortlessConfigs(root);
    loadDotenv({ path: envLocal, override: true });
  }

  const portDb = requireNumberEnv("PORT_DB");
  const project = projectName(slug);
  const db = worktreeDbTarget(slug, portDb);
  const mode = modeOf(db);
  if (recordedStackMode(slug) === null) writeStackMode(slug, mode);

  log.info(`booting migration services (${project})`);
  await ensureDockerRunning();
  if (mode === "shared") {
    const jwt = readDevJwt();
    const warning = await bootSharedServices(jwt);
    if (warning) log.warn(warning);
    await createWorktreeDatabase(db.database);
    await registerStorageTenant(db.database, jwt);
  } else {
    // The dev compose file joins carbon-shared in both modes.
    await ensureSharedNetwork();
  }

  // Tear down on Ctrl+C so the standalone postgres doesn't orphan.
  let interrupted = false;
  const detach = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping services…\n");
    void stopStack(root, slug, false).finally(() => process.exit(130));
  });

  try {
    await bootStack(root, slug, { services: MIGRATION_SERVICES[mode] });
    await waitForPostgres(db);
    await waitForServiceSchemas(db);

    await tasks([
      {
        title: "Apply database migrations",
        task: async () => {
          const r = await applyMigrations(root, db);
          return r.applied ? "migrations applied" : "schema already up to date";
        }
      },
      {
        title: "Seed pg_net config row",
        task: async () => {
          const anonKey = process.env.SUPABASE_ANON_KEY;
          if (!anonKey) return "skipped (SUPABASE_ANON_KEY not set)";
          await ensureConfigRow(db, anonKey, stackHosts(mode, slug));
          return "config row upserted";
        }
      },
      ...(shouldRegen
        ? [
            {
              title: "Regenerate types",
              task: async () => {
                // Always regenerate — the on-disk types must match the DB even
                // when no NEW migration ran this invocation (schema already
                // applied from a branch switch, stash-pop, or reverted
                // generated files). Gating on `applied` left stale types there.
                await execa("pnpm", ["db:types"], { cwd: root });
                return "types refreshed";
              }
            }
          ]
        : []),
      {
        title: "Sync RLS policies with the authz manifest",
        task: () => syncAuthz(root, db)
      }
    ]);

    if (shouldRegen) {
      log.warn(
        "swagger skipped — requires the API (run `crbn up` for full regen)"
      );
    }
  } finally {
    detach();
    log.info("stopping migration services");
    await stopStack(root, slug, false);
  }

  outro("done");
}
