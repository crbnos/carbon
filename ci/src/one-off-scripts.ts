// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One-off operational scripts, run once per database and then never again.
 *
 * The FOLDER is the registry: every `.ts` file in `scripts/one-off/` is a
 * script, discovered at runtime. Adding one is adding a file — there is no
 * list to keep in sync, so a script can never be present but unregistered
 * (silently never running) or registered but absent (failing every deploy).
 *
 * A script runs after `supabase db push`, so it can rely on the schema that
 * same deploy applied, and is recorded in the TARGET database's own
 * `scriptRun` table — see 20260921050318_script-run-ledger.sql for why the
 * ledger lives there rather than on the CI `workspaces` row, and
 * `scripts/one-off/README.md` for the rules a script must follow.
 *
 * NOTE: .github/workflows/supabase.yml only fires on pushes under
 * `packages/database/supabase/**`. A script that ships without a migration
 * therefore will NOT deploy on its own; land it alongside one, or run the
 * workflow manually (workflow_dispatch).
 */
export type OneOffScript = {
  /**
   * The file's basename without `.ts`, and the `scriptRun` primary key.
   * Renaming the FILE re-runs the script everywhere, so treat the filename as
   * the script's permanent identifier.
   */
  name: string;
  /** Absolute path to the script file. */
  path: string;
};

/** `scripts/one-off/`, resolved from this module rather than from a cwd. */
const ONE_OFF_DIR = fileURLToPath(
  new URL("../../scripts/one-off/", import.meta.url)
);

/**
 * What a runnable script is allowed to be named: `<kebab-case>.ts`.
 *
 * This is an ALLOWLIST, not a blocklist, because everything this matches gets
 * executed against every production database. A blocklist arms any filename
 * nobody thought to exclude; `scripts/lib/` already colocates `*.test.ts`
 * beside its sources, so a dev following that convention here would otherwise
 * ship a test file straight into production. Dotted names (`foo.test.ts`,
 * `foo.d.ts`) do not match, and anything else unrecognised is refused loudly
 * by `discoverOneOffScripts` rather than silently skipped.
 */
const SCRIPT_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;

/**
 * Every script in the folder, in a stable (alphabetical) order.
 *
 * Paths are absolute: the runner spawns scripts with `cwd: "supabase"` inside
 * a copied directory, so a relative path would be a hand-counted hop that
 * breaks the moment either location moves.
 *
 * Throws on any file that is neither a runnable script nor obviously
 * documentation. Refusing beats skipping: a script silently ignored for a
 * filename typo looks exactly like a script that has already run, and the
 * deploy would report success having done nothing.
 */
export function discoverOneOffScripts(
  dir: string = ONE_OFF_DIR
): OneOffScript[] {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) =>
    entry.isFile()
  );

  const unexpected = entries
    .map((entry) => entry.name)
    .filter((name) => !SCRIPT_FILENAME.test(name) && name !== "README.md");

  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected file(s) in scripts/one-off/: ${unexpected.join(", ")}. ` +
        "Only kebab-case `<name>.ts` scripts and README.md belong here — " +
        "every script in this folder runs against every production database. " +
        "See scripts/one-off/README.md."
    );
  }

  return entries
    .filter((entry) => SCRIPT_FILENAME.test(entry.name))
    .map((entry) => ({
      name: entry.name.slice(0, -".ts".length),
      path: `${dir}${entry.name}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Minimal schema for the ledger client. The ledger lives in the TARGET
 * database, which this package has no generated types for — declaring just
 * `scriptRun` keeps both the read and the write type-checked without pulling
 * @carbon/database into the CI package.
 */
export type LedgerDatabase = {
  public: {
    Tables: {
      scriptRun: {
        Row: { name: string; ranAt: string; result: unknown | null };
        Insert: { name: string; ranAt?: string; result?: unknown | null };
        Update: { name?: string; ranAt?: string; result?: unknown | null };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

type LedgerClient = SupabaseClient<LedgerDatabase>;

/**
 * Which discovered scripts have not yet run against this database.
 *
 * Throws when the ledger cannot be read, and the caller treats that as fatal:
 * a missing or unreadable `scriptRun` means we cannot tell what has already
 * run, and re-running blind is how a non-idempotent script corrupts a
 * production database. Fail loudly instead.
 */
export async function selectPendingScripts(
  ledger: LedgerClient,
  scripts: OneOffScript[] = discoverOneOffScripts()
): Promise<OneOffScript[]> {
  if (scripts.length === 0) return [];

  const { data, error } = await ledger
    .from("scriptRun")
    .select("name")
    .in(
      "name",
      scripts.map((script) => script.name)
    );

  if (error) {
    throw new Error(`Failed to read scriptRun ledger: ${error.message}`);
  }

  const alreadyRan = new Set((data ?? []).map((row) => row.name));
  return scripts.filter((script) => !alreadyRan.has(script.name));
}

/**
 * The exit code of a one-off script that cannot run on this workspace yet,
 * because the runner did not pass something it needs (EX_TEMPFAIL in
 * sysexits.h). The runner writes no ledger row, so the next deploy runs the
 * script again, and it does not fail the deploy: the workspace is not
 * broken, only not ready for the script. A script that uses it says so in
 * its header and logs why.
 */
export const ONE_OFF_SCRIPT_DEFERRED = 75;

export type OneOffScriptOutcome = "completed" | "deferred" | "failed";

/** What a script's exit code tells the runner. */
export function oneOffScriptOutcome(
  exitCode: number | undefined
): OneOffScriptOutcome {
  if (exitCode === 0) return "completed";
  return exitCode === ONE_OFF_SCRIPT_DEFERRED ? "deferred" : "failed";
}

/** One entry of the Management API's `GET /v1/projects/{ref}/config/database/pooler`. */
export type SupavisorConfig = {
  database_type: "PRIMARY" | "READ_REPLICA";
  db_user: string;
  db_host: string;
  db_port: number;
  db_name: string;
};

/**
 * The primary database's Supavisor URL (`aws-0-<region>.pooler.supabase.com`),
 * which resolves to IPv4. The workspace's own pooler URL is the project's
 * dedicated pooler on `db.<ref>.supabase.co`, which resolves to IPv6 only:
 * the deployed app reaches it, a GitHub-hosted runner (no IPv6) gets
 * ENETUNREACH. Null when the project lists no primary pooler.
 */
export function supavisorUrl(
  configs: SupavisorConfig[],
  password: string
): string | null {
  const primary = configs.find((c) => c.database_type === "PRIMARY");
  if (!primary) return null;
  const user = encodeURIComponent(primary.db_user);
  return `postgresql://${user}:${encodeURIComponent(password)}@${primary.db_host}:${primary.db_port}/${primary.db_name}`;
}

/**
 * The environment a one-off script runs with: the workspace's, without the
 * database password (only `supabase db push` uses it), and a Postgres URL the
 * runner can reach — the project's Supavisor URL (`supavisorUrl`), else the
 * pooler URL the app gets (deploy.ts), else a self-hosted connection string.
 * A workspace with none passes no `SUPABASE_DB_URL`, and a script that needs
 * one defers (`ONE_OFF_SCRIPT_DEFERRED`).
 */
export function oneOffScriptEnv(
  env: Record<string, string | undefined>,
  {
    poolerUrl,
    connectionString
  }: { poolerUrl: string | null; connectionString: string | null }
): Record<string, string | undefined> {
  const { SUPABASE_DB_PASSWORD: _password, ...scriptEnv } = env;
  return {
    ...scriptEnv,
    SUPABASE_DB_URL:
      poolerUrl ??
      (connectionString?.startsWith("postgresql://")
        ? connectionString
        : undefined)
  };
}
