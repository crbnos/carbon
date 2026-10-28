// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createRequire } from "node:module";
import { OeeProviderUnavailableError } from "../../packages/ee/src/oee/types";
import {
  ensureSenseWebhook,
  webhookOrigin
} from "../../packages/ee/src/sense/webhook.server";
import { readLocalScriptConfig } from "../lib/local-script-config";

// One-off, idempotent: register the Sense webhook of every company that
// installed Sense before Carbon used it. A new install, and every save of the
// Sense settings, registers it through `ensureSenseWebhook`; an install made
// before that ran only on the sweep, now every 10 minutes. This runs the same
// function once for each of them. Re-running only re-points a webhook that
// already points here and keeps its secret.
//
// Needs `ERP_URL` (the runner builds it from the workspace's `url_erp`), and
// the app must already serve `/api/webhook/sense/:companyId`: a webhook
// registered before then gets 404s, and Sense disables a webhook that keeps
// failing. Without either it exits ONE_OFF_SCRIPT_DEFERRED and runs on a
// later deploy. So does a Sense outage. Any other failure for a company (a
// revoked API key) is reported and left: saving that company's Sense settings
// registers it once the key is fixed.
//
// Safe to remove once every deployment has run it. `--dry-run` lists the
// companies it would register.

/** ONE_OFF_SCRIPT_DEFERRED in ci/src/one-off-scripts.ts. */
const DEFERRED = 75;

const isDryRun = process.argv.includes("--dry-run");

const { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } =
  readLocalScriptConfig(
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    process.env
  );

function createServiceRoleClient(url: string, serviceRole: string) {
  // The database workspace declares and pins this dependency; root scripts do not.
  const fromDatabase = createRequire(
    new URL("../../packages/database/package.json", import.meta.url)
  );
  const { createClient } = fromDatabase("@supabase/supabase-js");
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function main(): Promise<number> {
  const client = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await client
    .from("companyIntegration")
    .select("companyId")
    .eq("id", "sense")
    .eq("active", true);
  if (error) throw new Error(`Failed to read Sense installs: ${error.message}`);

  const companyIds = (data as { companyId: string }[]).map(
    (row) => row.companyId
  );
  if (companyIds.length === 0) {
    console.log("No active Sense integration: nothing to register.");
    return 0;
  }

  // Explicit only: unset, `@carbon/env` falls back to https://app.carbon.ms,
  // and this database's companies would be registered against another app.
  const origin = process.env.ERP_URL ? webhookOrigin() : null;
  if (!origin) {
    console.error(
      `${companyIds.length} Sense install(s), but ERP_URL is not an HTTPS origin (${process.env.ERP_URL ?? "unset"}).`
    );
    return DEFERRED;
  }

  const probe = `${origin}/api/webhook/sense/${companyIds[0]}`;
  const live = await fetch(probe, { signal: AbortSignal.timeout(15_000) })
    .then((response) => response.ok)
    .catch(() => false);
  if (!live) {
    console.error(`The app does not serve ${probe} yet.`);
    return DEFERRED;
  }

  let unavailable = false;
  for (const companyId of companyIds) {
    if (isDryRun) {
      console.log(`Would register the Sense webhook of ${companyId}`);
      continue;
    }
    try {
      await ensureSenseWebhook(companyId);
      console.log(`Registered the Sense webhook of ${companyId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Sense webhook of ${companyId} not registered: ${message}`);
      if (error instanceof OeeProviderUnavailableError) unavailable = true;
    }
  }
  return unavailable ? DEFERRED : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(DEFERRED);
  });
