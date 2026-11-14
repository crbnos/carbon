// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { cancel, intro, log, outro } from "@clack/prompts";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "pathe";
import pc from "picocolors";
import { loadEnvFiles } from "../env.js";
import { tryConnect } from "../helpers.js";
import { confirmDestructive } from "../prompts.js";
import { wakeIfAsleep } from "../services/hibernate.js";
import { databaseTasks, serviceSchemasReady } from "../services/migrations.js";
import { currentStack, type DbTarget } from "../stack.js";
import { tasks } from "../ui.js";

export type RestoreMode = "local" | "prod";

type RestoreOptions = {
  file: string;
  scrubEmails?: boolean;
  adminEmail?: string;
  adminPassword?: string;
  mode?: RestoreMode;
  keepStorageObjects?: boolean;
  migrate?: boolean;
  regen?: boolean;
  yes?: boolean;
};

const SCRIPT = "scripts/restore-database.sh";

/**
 * Build the environment the restore script reads.
 *
 * `SCRUB_EMAILS` is opt-IN in the script but defaults ON here: a dev CLI should
 * not drop real customer email addresses into a local database unless asked.
 * The script treats any non-empty value as true, so opting out means omitting
 * the key entirely rather than setting "0".
 */
export function buildRestoreEnv(
  opts: Pick<
    RestoreOptions,
    | "scrubEmails"
    | "adminEmail"
    | "adminPassword"
    | "mode"
    | "keepStorageObjects"
  >,
  db: DbTarget
): Record<string, string> {
  const env: Record<string, string> = {
    RESTORE_MODE: opts.mode ?? "local"
  };
  // In shared mode the wt_ database on the shared Postgres, which the
  // registry's PORT_DB does not name.
  env.PORT_DB = String(db.port);
  env.DB_NAME = db.database;
  if (opts.scrubEmails !== false) env.SCRUB_EMAILS = "1";
  if (opts.adminEmail) env.ADMIN_EMAIL = opts.adminEmail;
  if (opts.adminPassword) env.ADMIN_PASSWORD = opts.adminPassword;
  if (opts.keepStorageObjects) env.KEEP_STORAGE_OBJECTS = "1";
  return env;
}

export async function restore(opts: RestoreOptions) {
  intro("Carbon · dev restore");

  const stack = await currentStack();
  const { root } = stack;

  const backup = isAbsolute(opts.file) ? opts.file : resolve(opts.file);
  if (!existsSync(backup)) {
    cancel(`backup file not found: ${backup}`);
    process.exit(1);
  }
  if (!existsSync(join(root, SCRIPT))) {
    cancel(`${SCRIPT} is missing from this worktree`);
    process.exit(1);
  }
  loadEnvFiles(root);
  const { db } = stack;
  if (!db) {
    cancel(
      "this worktree has no database yet — run `crbn up` once to provision it"
    );
    process.exit(1);
  }

  const mode = opts.mode ?? "local";
  // Warned unconditionally: --yes also skips the confirmation, so gating this on
  // !yes made the most dangerous invocation the silent one.
  if (mode === "prod") {
    log.warn(
      "--mode prod skips ALL localization: webhooks, integrations and printer routes stay pointed at the source environment"
    );
  }
  if (opts.scrubEmails === false) {
    log.warn(
      "--no-scrub-emails: real email addresses from the backup will be present locally"
    );
  }

  if (!opts.yes) {
    await confirmDestructive(
      "Confirming a restore",
      `Replace the database on 127.0.0.1:${pc.bold(String(db.port))} with ${pc.bold(backup)}? (mode: ${mode} — the current data, including any seeded test data, is wiped)`
    );
  }

  // A restore rewrites `auth`/`storage` too, whose schemas GoTrue's and
  // Storage's own migrations build when THOSE containers boot. Against a
  // Postgres alone the dump's `CREATE TABLE auth.users` no-ops onto the
  // image's stub, and the restore fails late — after the data has landed but
  // before the email scrub — leaving unscrubbed production addresses on disk.
  await wakeIfAsleep(stack.slug);
  if (!(await tryConnect("127.0.0.1", db.port, 500))) {
    cancel("postgres is not reachable — run `crbn up` first, then retry");
    process.exit(1);
  }
  if (!(await serviceSchemasReady(db).catch(() => false))) {
    cancel(
      "the auth/storage schemas are not initialized (postgres is up but GoTrue/Storage are not) — run `crbn up` so the full stack boots once, then retry"
    );
    process.exit(1);
  }

  // stdio inherit: the script streams its own progress and can run for minutes.
  await execa("bash", [join(root, SCRIPT), backup], {
    cwd: root,
    stdio: "inherit",
    env: buildRestoreEnv(opts, db)
  });

  const shouldMigrate = opts.migrate !== false;
  const shouldRegen = opts.regen !== false;
  await tasks(
    databaseTasks(
      { ...stack, db },
      {
        // The dump carries the SOURCE environment's schema and policies, usually
        // behind this branch's.
        migrate: shouldMigrate,
        regen: shouldRegen,
        swagger: false,
        // The script writes the private stack's hosts, wrong for a shared one.
        configRow: mode === "local"
      }
    )
  );

  if (shouldRegen) {
    // These types now describe the RESTORED database, which carries whatever
    // the source environment accumulated outside the migration stream. Commit
    // them and that drift enters the repo's type surface.
    log.warn(
      "types were regenerated from the restored snapshot — do NOT commit them; run `pnpm db:types` against a migration-built database before committing"
    );
  }
  outro("done");
}
