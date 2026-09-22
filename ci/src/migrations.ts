import { createClient } from "@supabase/supabase-js";
import { $ } from "execa";

import { client } from "./client";
import type { LedgerDatabase } from "./one-off-scripts";
import { selectPendingScripts } from "./one-off-scripts";
import {
  SUPABASE_ACCESS_TOKEN,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI,
} from "./env";

export type Workspace = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  seeded: boolean;
  connection_string: string | null;
  database_url: string | null;
  project_id: string | null;
  access_token: string | null;
  anon_key: string | null;
  database_password: string | null;
  jwt_key: string | null;
  service_role_key: string | null;
};

/**
 * Run the one-off scripts this workspace has not run yet, recording each in the
 * workspace's OWN `scriptRun` table. The scripts are whatever is in
 * `scripts/one-off/` — see that folder's README.
 *
 * Runs after `supabase db push`, so a script can rely on the schema the same
 * deploy just applied — the bucket copy needs the buckets that
 * 20260917163108_company-bucket-provisioning.sql provisions.
 *
 * A script is spawned as a subprocess with the per-workspace env explicitly
 * injected rather than imported and called: `scripts/lib/local-script-config.ts`
 * lets a `.env.local` file OVERRIDE the passed environment, so an in-process
 * call could silently target the wrong database on any machine that has one.
 *
 * A failure here does NOT abort the workspace's migration — the schema is
 * already pushed and correct. Returns false instead of throwing so the caller
 * can mark the run errored without the failure being re-reported as a failed
 * migration; because nothing is recorded in the ledger, the next deploy
 * retries it.
 */
async function runPendingScripts(
  workspace: Workspace,
  $$: typeof $
): Promise<boolean> {
  const { database_url, service_role_key } = workspace;
  if (!database_url || !service_role_key) {
    console.log(
      `⏭️  Skipping one-off scripts for ${workspace.id}: missing database url or service role key`
    );
    return true;
  }

  const ledger = createClient<LedgerDatabase>(database_url, service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pending = await selectPendingScripts(ledger);
  if (pending.length === 0) return true;

  let succeeded = true;

  for (const script of pending) {
    console.log(`✅ 📜 Running ${script.name} for ${workspace.id}`);
    try {
      const { stdout } = await $$`tsx ${script.path}`;
      const tail = stdout.trim().split("\n").slice(-20).join("\n");

      // ignoreDuplicates: a row for this name may already exist — a retried
      // insert whose first attempt landed, or an earlier run that recorded it.
      // Either way the run IS recorded; keep the original row (and its ranAt)
      // rather than failing the whole deploy over bookkeeping.
      const { error } = await ledger
        .from("scriptRun")
        .upsert(
          { name: script.name, result: { output: tail } },
          { onConflict: "name", ignoreDuplicates: true }
        );

      if (error) {
        // The work is done but unrecorded, so the next deploy runs it again.
        // Every listed script must be idempotent for exactly this reason.
        throw new Error(
          `ran but could not be recorded: ${error.message}. It will run again on the next deploy.`
        );
      }

      console.log(`✅ 📜 Completed ${script.name} for ${workspace.id}`);
    } catch (e) {
      console.error(`🔴 📜 Script ${script.name} failed for ${workspace.id}`, e);
      succeeded = false;
    }
  }

  if (!succeeded) {
    console.error(
      `🔴 📜 One or more one-off scripts failed for ${workspace.id}. Migrations already succeeded; the failed scripts are unrecorded and retry on the next deploy.`
    );
  }

  return succeeded;
}

async function migrate(): Promise<void> {
  console.log("✅ 🌱 Starting migrations");

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("*");

  if (error) {
    console.error("🔴 🍳 Failed to fetch workspaces", error);
    process.exit(1);
  }

  let hasErrors = false;

  console.log("✅ 🛩️ Successfully retreived workspaces");

  console.log("👯‍♀️ Copying supabase folder");
  await $`cp -r ../packages/database/supabase .`;
  await $`cp -r ../packages/database/src .`;

  for await (const workspace of workspaces as Workspace[]) {
    try {
      console.log(`✅ 🥚 Migrating ${workspace.id}`);
      const {
        connection_string,
        database_url,
        database_password,
        service_role_key,
        project_id,
        anon_key,
        access_token,
      } = workspace;
      if (!database_url) {
        console.log(`🔴🍳 Missing database url for ${workspace.id}`);
        continue;
      }

      console.log(`✅ 🔑 Setting up environment for ${workspace.id}`);

      let $$ = $({
        // @ts-ignore
        env: {
          SUPABASE_ACCESS_TOKEN:
            access_token === null ? SUPABASE_ACCESS_TOKEN : access_token,
          SUPABASE_URL: database_url ?? undefined,
          SUPABASE_DB_PASSWORD: database_password ?? undefined,
          SUPABASE_PROJECT_ID: project_id ?? undefined,
          SUPABASE_ANON_KEY: anon_key ?? undefined,
          SUPABASE_SERVICE_ROLE_KEY: service_role_key ?? undefined,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI,
          ...(connection_string?.startsWith("postgresql://") && {
            PGSSLMODE: "disable",
          }),
        },
        cwd: "supabase",
      });

      if (project_id) {
        await $$`supabase link`;
      }

      console.log(`✅ 🐣 Starting migrations for ${workspace.id}`);


      if (connection_string && connection_string.startsWith("postgresql://")) {
        await $$`supabase db push --db-url ${connection_string} --include-all`;
      } else {
        await $$`supabase db push --include-all`;
        console.log(`✅ 🐣 Starting deployments for ${workspace.id}`);
        await $$`supabase functions deploy`;
      }

      if (!workspace.seeded) {
        try {
          console.log(`✅ 🌱 Seeding ${workspace.id}`);
          await $$`tsx ../../packages/database/src/seed.ts`;
          const { error } = await client
            .from("workspaces")
            .update({ seeded: true })
            .eq("id", workspace.id);

          if (error) {
            throw new Error(
              `🔴 🍳 Failed to mark ${workspace.id} as seeded: ${error.message}`
            );
          }

          // TODO: run the seed.sql file
        } catch (e) {
          console.error(`🔴 🍳 Failed to seed ${workspace.id}`, e);
        }
      }

      console.log(`✅ 🐓 Successfully migrated ${workspace.id}`);

      // After the success log: the schema is pushed and correct regardless of
      // how the scripts go, so a script failure must not read as a failed
      // migration. It still fails the overall run via `hasErrors`.
      if (!(await runPendingScripts(workspace, $$))) {
        hasErrors = true;
      }
    } catch (error) {
      console.error(`🔴 🍳 Failed to migrate ${workspace.id}`, error);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("🔴 Migration completed with errors");
    process.exit(1);
  }

  console.log("✅ All migrations completed successfully");
}

migrate().catch((error) => {
  console.error("🔴 Unexpected error during migration", error);
  process.exit(1);
});
