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

/** One thing a workspace's freshly deployed ERP tells a service. */
type Step = { name: string; run: () => Promise<unknown> };

function stepsFor(workspace: Workspace): Step[] {
  const { id, url_erp, project_id, access_token } = workspace;
  if (!url_erp) return [];
  const steps: Step[] = [
    {
      name: `Inngest sync for workspace ${id} (${url_erp})`,
      // --fail: an HTTP error is a failed sync, not a successful curl.
      run: () => $`curl --fail --silent --show-error -X PUT https://${url_erp}/api/inngest`
    }
  ];
  // A hosted Supabase project keeps Auth's emails as settings: copy in the
  // ones this ERP serves now that it is deployed (auth-emails.ts).
  if (project_id) {
    steps.push({
      name: `Auth emails for workspace ${id}`,
      run: () =>
        pushAuthEmails(
          `https://${url_erp}`,
          project_id,
          access_token ?? SUPABASE_ACCESS_TOKEN
        )
    });
  }
  return steps;
}

/**
 * After a deploy, for every workspace's ERP: Inngest learns its jobs
 * (PUT /api/inngest), and a hosted Supabase project gets its Auth emails
 * (auth-emails.ts). No step waits on another, so all of them run at once,
 * and one that fails fails the run only after the rest have finished.
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

  for (const { id, url_erp } of workspaces as Workspace[]) {
    if (!url_erp) console.log(`⏭️ Skipping workspace ${id} — no url_erp`);
  }

  const results = await Promise.all(
    (workspaces as Workspace[]).flatMap(stepsFor).map(async (step) => {
      try {
        await step.run();
        console.log(`✅ ${step.name}`);
        return true;
      } catch (err) {
        console.error(`🔴 ${step.name} failed`, err);
        return false;
      }
    })
  );

  if (results.includes(false)) {
    console.error("🔴 Post-deploy sync completed with errors");
    process.exit(1);
  }

  console.log("✅ Post-deploy sync completed");
}

postDeploy().catch((error) => {
  console.error("🔴 Unexpected error during the post-deploy sync", error);
  process.exit(1);
});
