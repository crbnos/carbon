import { existsSync } from "node:fs";
import { intro, log, outro, tasks } from "@clack/prompts";
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
import { applyMigrations, waitForPostgres } from "../services/migrations.js";
import { branchToPrefix } from "../services/portless.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlot,
  resolveSlug
} from "../worktree.js";

// Run database migrations against the worktree's local stack. If postgres is
// already running (full stack up), migrate against it directly. If not, boot
// just postgres, apply migrations + regenerate types, then tear down — no need
// for the full 11-service compose stack to run migrations.
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

  // If postgres is already reachable, migrate against the running DB.
  if (portDb && (await tryConnect("127.0.0.1", portDb, 500))) {
    return migrateAgainstRunningDb(root, portDb, shouldRegen);
  }

  // Standalone mode: boot just postgres, migrate, tear down.
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
    ...(shouldRegen
      ? [
          {
            title: "Regenerate types & swagger",
            task: async () => {
              if (!applied) return "skipped (no new migrations)";
              await execa("pnpm", ["db:types"], { cwd: root });
              await execa("pnpm", ["generate:swagger"], { cwd: root });
              return "types + swagger refreshed";
            }
          }
        ]
      : [])
  ]);
  outro("done");
}

// ─── Standalone path (postgres-only) ──────────────────────────────────────

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

  log.info(`booting postgres-only stack (${project})`);
  await ensureDockerRunning();

  // Tear down on Ctrl+C so the standalone postgres doesn't orphan.
  let interrupted = false;
  const detach = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping postgres…\n");
    void stopStack(root, slug, false).finally(() => process.exit(130));
  });

  try {
    await bootStack(root, slug, { services: ["postgres"] });
    await waitForPostgres(portDb);

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
      ...(shouldRegen
        ? [
            {
              title: "Regenerate types",
              task: async () => {
                if (!applied) return "skipped (no new migrations)";
                await execa("pnpm", ["db:types"], { cwd: root });
                return "types refreshed";
              }
            }
          ]
        : [])
    ]);

    if (shouldRegen) {
      log.warn(
        "swagger skipped — requires Studio (run `crbn up` for full regen)"
      );
    }
  } finally {
    detach();
    log.info("stopping postgres-only stack");
    await stopStack(root, slug, false);
  }

  outro("done");
}
