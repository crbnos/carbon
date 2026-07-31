/**
 * Development seed script for Carbon.
 *
 * Fills one company with a small-satellite manufacturer's worth of realistic
 * data across the whole ERP — every list screen has rows, every detail screen
 * opens. Re-running wipes this company's business data and rebuilds it; the
 * company's reference/config data is preserved.
 *
 * An email that belongs to no company bootstraps a brand new user + company
 * first, which is what `crbn up` relies on for test@carbon.ms.
 *
 * Usage:
 *   pnpm run db:seed:dev -- --email your@email.com
 */

import process from "node:process";
import { getPostgresConnectionPool } from "./client.ts";
import { bootstrap, DEV_PASSWORD } from "./seed-dev/bootstrap.ts";
import { loadEnv, parseSeedArgs } from "./seed-dev/cli.ts";
import { ensureSequences, printSummary } from "./seed-dev/sql.ts";
import { selectTiers } from "./seed-dev/tiers/index.ts";
import { buildCtx, resolveCompany } from "./seed-dev/types.ts";
import { wipeCompanyBusinessData } from "./seed-dev/wipe.ts";

loadEnv();

async function main() {
  const { email, tiers, skipWipe } = parseSeedArgs();
  console.log(`\nSeeding development environment for: ${email}\n`);

  const pool = getPostgresConnectionPool(1);
  const client = await pool.connect();

  try {
    let resolved = await resolveCompany(client, email);
    if (!resolved) {
      console.log("No company for that email — bootstrapping a new one...");
      resolved = await bootstrap(client, email);
      console.log(`  Company ${resolved.companyId} created.`);
    }
    const { companyId, userId } = resolved;

    const ctx = await buildCtx(client, companyId, userId);
    const selected = selectTiers(tiers);

    await client.query("BEGIN");
    try {
      // Suppresses dispatch_event_batch (pgmq + pg_net). Sync interceptors
      // still run, so the satellite rows we depend on are still created.
      await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);

      // Must run before resetSequences, and before any nextSequence() call.
      await ensureSequences(client, companyId);

      if (skipWipe) {
        console.log("Skipping wipe (--skip-wipe).");
      } else {
        console.log("Wiping existing business data...");
        await wipeCompanyBusinessData(ctx);
      }

      for (const tier of selected) {
        console.log(`Tier ${tier.n}: ${tier.name}`);
        await tier.run(ctx);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    await printSummary(client, companyId);
    console.log(`
========================================
Dev environment seeded successfully!
========================================

  Email:      ${email}
  Password:   ${DEV_PASSWORD} (only set when the user was just created)
  Company ID: ${companyId}
`);
  } catch (error) {
    console.error("\nError seeding development environment:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
