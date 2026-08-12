import { existsSync } from "node:fs";
import { cancel, intro, log, outro, tasks } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "pathe";
import { requireNumberEnv, tryConnect } from "../helpers.js";
import { confirmRestore } from "../prompts.js";
import {
  applyMigrations,
  serviceSchemasReady
} from "../services/migrations.js";
import { getWorktreeRoot } from "../worktree.js";

export type RestoreMode = "local" | "prod";

export type RestoreOptions = {
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
  >
): Record<string, string> {
  const env: Record<string, string> = {
    RESTORE_MODE: opts.mode ?? "local"
  };
  if (opts.scrubEmails !== false) env.SCRUB_EMAILS = "1";
  if (opts.adminEmail) env.ADMIN_EMAIL = opts.adminEmail;
  if (opts.adminPassword) env.ADMIN_PASSWORD = opts.adminPassword;
  if (opts.keepStorageObjects) env.KEEP_STORAGE_OBJECTS = "1";
  return env;
}

export async function restore(opts: RestoreOptions) {
  intro("Carbon · dev restore");

  const root = await getWorktreeRoot();

  const backup = isAbsolute(opts.file) ? opts.file : resolve(opts.file);
  if (!existsSync(backup)) {
    cancel(`backup file not found: ${backup}`);
    process.exit(1);
  }
  if (!existsSync(join(root, SCRIPT))) {
    cancel(`${SCRIPT} is missing from this worktree`);
    process.exit(1);
  }

  const envLocal = join(root, ".env.local");
  if (existsSync(envLocal)) loadDotenv({ path: envLocal, override: true });
  loadDotenv({ path: join(root, ".env"), override: false });

  let portDb: number;
  try {
    portDb = requireNumberEnv("PORT_DB");
  } catch {
    cancel("PORT_DB not set — run `crbn up` once to provision this worktree");
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

  if (
    !opts.yes &&
    !(await confirmRestore({ port: portDb, file: backup, mode }))
  ) {
    cancel("restore aborted");
    process.exit(0);
  }

  // Deliberately NOT booting a postgres-only stack the way `crbn migrate` does.
  // A restore rewrites `auth`/`storage` too, and those schemas are built by
  // GoTrue's and Storage's own migrations when THOSE containers boot. Against a
  // postgres-only stack the dump's `CREATE TABLE auth.users` no-ops onto the
  // image's stub, and the restore fails late — after the data has landed but
  // before the email scrub — leaving unscrubbed production addresses on disk.
  if (!(await tryConnect("127.0.0.1", portDb, 500))) {
    cancel("postgres is not reachable — run `crbn up` first, then retry");
    process.exit(1);
  }
  if (!(await serviceSchemasReady(portDb))) {
    cancel(
      "the auth/storage schemas are not initialized (postgres is up but GoTrue/Storage are not) — run `crbn up` so the full stack boots once, then retry"
    );
    process.exit(1);
  }

  await runRestore(root, backup, portDb, opts);
  outro("done");
}

async function runRestore(
  root: string,
  backup: string,
  portDb: number,
  opts: RestoreOptions
) {
  // stdio inherit: the script streams its own progress and can run for minutes.
  await execa("bash", [join(root, SCRIPT), backup], {
    cwd: root,
    stdio: "inherit",
    env: buildRestoreEnv(opts)
  });

  const shouldMigrate = opts.migrate !== false;
  const shouldRegen = opts.regen !== false;
  if (!shouldMigrate && !shouldRegen) return;

  await tasks([
    ...(shouldMigrate
      ? [
          {
            // The dump carries the SOURCE environment's schema, which is
            // usually behind this branch. Without this the DB is left at prod's
            // migration state and app code compiled from newer types breaks.
            title: "Apply migrations the backup predates",
            task: async () => {
              const r = await applyMigrations(root, portDb);
              return r.applied
                ? "migrations applied"
                : "schema already up to date";
            }
          }
        ]
      : []),
    ...(shouldRegen
      ? [
          {
            title: "Regenerate types",
            task: async () => {
              await execa("pnpm", ["db:types"], { cwd: root });
              return "types refreshed";
            }
          }
        ]
      : [])
  ]);

  if (shouldRegen) {
    // These types now describe the RESTORED database, which carries whatever
    // the source environment accumulated outside the migration stream. Commit
    // them and that drift enters the repo's type surface.
    log.warn(
      "types were regenerated from the restored snapshot — do NOT commit them; run `pnpm db:types` against a migration-built database before committing"
    );
  }
}
