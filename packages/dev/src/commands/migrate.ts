// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { intro, log, outro } from "@clack/prompts";
import { join } from "pathe";
import { loadEnvFiles, writeStackEnv } from "../env.js";
import { currentBranch } from "../git.js";
import { onShutdown, tryConnect } from "../helpers.js";
import {
  bootSharedServices,
  bootStack,
  ensureDockerRunning,
  ensureSharedNetwork,
  ensureSlugAvailable,
  stopStack
} from "../services/compose.js";
import { wakeIfAsleep } from "../services/hibernate.js";
import {
  databaseTasks,
  serviceSchemasReady,
  waitForPostgres,
  waitForServiceSchemas
} from "../services/migrations.js";
import { branchToPrefix } from "../services/portless.js";
import { provisionWorktreeData } from "../services/shared-db.js";
import { currentStack, type Stack } from "../stack.js";
import type { StackMode } from "../topology.js";
import { tasks } from "../ui.js";
import {
  persistSlug,
  readDevJwt,
  resolveSlot,
  stackDatabase,
  writeStackMode
} from "../worktree.js";

// Shared mode runs Postgres and Storage in crbn-shared, so only the 2 services
// that build their schemas in the worktree database boot here.
const MIGRATION_SERVICES: Record<StackMode, string[]> = {
  isolated: ["postgres", "gotrue", "storage", "realtime"],
  shared: ["gotrue", "realtime"]
};

// Migrate the worktree's database. Against the running stack when its
// database answers; otherwise boot only the services whose schemas the
// migrations write into, migrate, and stop them again.
export async function migrate(opts: { regen?: boolean } = {}) {
  const regen = opts.regen ?? true;
  intro("Carbon · dev migrate");

  let stack = await currentStack();
  loadEnvFiles(stack.root);
  if (await wakeIfAsleep(stack.slug)) log.info("woke the hibernated stack");

  const { db } = stack;
  if (db && (await tryConnect("127.0.0.1", db.port, 500))) {
    const apiUp =
      stack.ports !== null &&
      (await tryConnect("127.0.0.1", stack.ports.PORT_API, 500));
    // The shared Postgres is up for every worktree: this one's stack is up
    // when its gateway answers. Never boot or stop it then.
    if (stack.mode === "isolated" || apiUp) {
      if (apiUp) await waitForServiceSchemas(db);
      return migrateRunning(stack, regen, apiUp);
    }
    // Stack down, but GoTrue and Realtime built their schemas before.
    if (await serviceSchemasReady(db).catch(() => false)) {
      return migrateRunning(stack, regen, false);
    }
  }

  // Compose reads .env.local: without one, no `crbn up` ran here yet.
  if (!existsSync(join(stack.root, ".env.local")))
    stack = await provision(stack);
  return migrateStandalone(stack, regen);
}

async function migrateRunning(stack: Stack, regen: boolean, swagger: boolean) {
  await tasks(
    databaseTasks(
      { ...stack, db: stack.db! },
      {
        migrate: true,
        regen,
        swagger
      }
    )
  );
  outro("done");
}

// Give the worktree a slot and an .env.local, in the mode `up` defaults to.
async function provision(stack: Stack): Promise<Stack> {
  log.info("provisioning worktree slot (first run)");
  await ensureDockerRunning();
  await ensureSlugAvailable(stack.slug, stack.root);
  persistSlug(stack.root, stack.slug);
  const slot = await resolveSlot(stack.slug, stack.root);
  writeStackMode(stack.slug, "shared");
  writeStackEnv(stack.root, {
    slug: stack.slug,
    ...slot,
    prefix: branchToPrefix(await currentBranch(stack.root), stack.slug),
    mode: "shared",
    database: stackDatabase(stack.slug, "shared")
  });
  return currentStack();
}

async function migrateStandalone(stack: Stack, regen: boolean) {
  const db = stack.db!;
  log.info(`booting migration services (${stack.project})`);
  await ensureDockerRunning();
  if (stack.mode === "shared") {
    const jwt = readDevJwt();
    const warning = await bootSharedServices(jwt);
    if (warning) log.warn(warning);
    await provisionWorktreeData(db.database, jwt);
  } else {
    // The dev compose file joins carbon-shared in both modes.
    await ensureSharedNetwork();
  }

  let interrupted = false;
  const detach = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping services…\n");
    void stopStack(stack).finally(() => process.exit(130));
  });

  try {
    await bootStack(stack, { services: MIGRATION_SERVICES[stack.mode] });
    await waitForPostgres(db);
    await waitForServiceSchemas(db);
    await tasks(
      databaseTasks(
        { ...stack, db },
        {
          migrate: true,
          regen,
          swagger: false
        }
      )
    );
    if (regen) {
      log.warn(
        "swagger skipped — requires the API (run `crbn up` for full regen)"
      );
    }
  } finally {
    detach();
    log.info("stopping migration services");
    await stopStack(stack);
  }
  outro("done");
}
