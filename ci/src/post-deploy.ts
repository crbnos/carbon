// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { $ } from "execa";

import { pushAuthEmails } from "./auth-emails";
import { client } from "./client";
import { SUPABASE_ACCESS_TOKEN } from "./env";

type Workspace = {
  id: number;
  url_erp: string | null;
  project_id: string | null;
  access_token: string | null;
};

/**
 * After a deploy, for every workspace's ERP: Inngest learns its jobs
 * (PUT /api/inngest), and a hosted Supabase project gets its Auth emails
 * (auth-emails.ts).
 */
async function postDeploy(): Promise<void> {
  console.log("✅ 🌱 Starting the post-deploy sync");

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("id, url_erp, project_id, access_token");

  if (error) {
    console.error("🔴 🍳 Failed to fetch workspaces", error);
    process.exit(1);
  }

  let hasErrors = false;

  for (const workspace of workspaces as Workspace[]) {
    const { id, url_erp, project_id, access_token } = workspace;

    if (!url_erp) {
      console.log(`⏭️ Skipping workspace ${id} — no url_erp`);
      continue;
    }

    try {
      console.log(`✅ 🔄 Syncing jobs for workspace ${id} (${url_erp})`);
      await $`curl -X PUT https://${url_erp}/api/inngest`;
      console.log(`✅ 🐓 Successfully synced jobs for workspace ${id}`);
    } catch (err) {
      console.error(`🔴 🍳 Failed to sync jobs for workspace ${id}`, err);
      hasErrors = true;
    }

    // A hosted Supabase project keeps Auth's emails as settings: copy in the
    // ones this ERP serves now that it is deployed (auth-emails.ts).
    if (project_id) {
      try {
        await pushAuthEmails(
          `https://${url_erp}`,
          project_id,
          access_token ?? SUPABASE_ACCESS_TOKEN
        );
        console.log(`✅ ✉️ Set Auth's emails for workspace ${id}`);
      } catch (err) {
        console.error(`🔴 ✉️ Failed to set Auth's emails for workspace ${id}`, err);
        hasErrors = true;
      }
    }
  }

  if (hasErrors) {
    console.error("🔴 Post-deploy sync completed with errors");
    process.exit(1);
  }

  console.log("✅ Post-deploy sync completed");
}

postDeploy().catch((error) => {
  console.error("🔴 Unexpected error during the post-deploy sync", error);
  process.exit(1);
});
