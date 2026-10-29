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
  bootStack,
  ensureDockerRunning,
  stopStack
} from "../services/compose.js";
import { wakeIfAsleep } from "../services/hibernate.js";
import {
  applyMigrations,
  ensureConfigRow,
  syncAuthz,
  waitForPostgres,
  waitForServiceSchemas
} from "../services/migrations.js";
import { branchToPrefix } from "../services/portless.js";
import { tasks } from "../ui.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlot,
  resolveSlug
} from "../worktree.js";

const MIGRATION_SERVICES = ["postgres", "gotrue", "storage", "realtime"];

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
    return migrateAgainstRunningDb(root, portDb, shouldRegen);
  }

  // Standalone mode: boot the migration services, migrate, tear down.
  return migrateStandalone(root, slug, shouldRegen);
}

// ─── Running-stack path (existing behavior) ──────────────────────────────

async function migrateAgainstRunningDb(
  root: string,
  portDb: number,
  shouldRegen: boolean
) {
  let applied = false;
  await tasks([
    {
      title: "Apply database migrations",
      task: async () => {
        const r = await applyMigrations(root, portDb);
        applied = r.applied;
        return r.applied ? "migrations applied" : "schema already up to date";
      }
    },
    {
      title: "Seed pg_net config row",
      task: async () => {
        const anonKey = process.env.SUPABASE_ANON_KEY;
        if (!anonKey) return "skipped (SUPABASE_ANON_KEY not set)";
        await ensureConfigRow(portDb, anonKey);
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
      task: () => syncAuthz(root, portDb)
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
    writeEnv(root, renderEnv({ slug, portless: true, branchPrefix, ...slot }));
    syncAppPortlessConfigs(root);
    loadDotenv({ path: envLocal, override: true });
  }

  const portDb = requireNumberEnv("PORT_DB");
  const project = projectName(slug);

  log.info(`booting migration services (${project})`);
  await ensureDockerRunning();

  // Tear down on Ctrl+C so the standalone postgres doesn't orphan.
  let interrupted = false;
  const detach = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping services…\n");
    void stopStack(root, slug, false).finally(() => process.exit(130));
  });

  try {
    await bootStack(root, slug, { services: MIGRATION_SERVICES });
    await waitForPostgres(portDb);
    await waitForServiceSchemas(portDb);

    await tasks([
      {
        title: "Apply database migrations",
        task: async () => {
          const r = await applyMigrations(root, portDb);
          return r.applied ? "migrations applied" : "schema already up to date";
        }
      },
      {
        title: "Seed pg_net config row",
        task: async () => {
          const anonKey = process.env.SUPABASE_ANON_KEY;
          if (!anonKey) return "skipped (SUPABASE_ANON_KEY not set)";
          await ensureConfigRow(portDb, anonKey);
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
        task: () => syncAuthz(root, portDb)
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
