/**
 * Development seed script for Carbon.
 *
 * Fills one company with an industry story's worth of realistic data across the
 * whole ERP — every list screen has rows, every detail screen opens. The data and
 * the insertion logic live in `src/datasets/`, shared with the onboarding demo
 * template; this file is the dev-only wrapper that bootstraps and wipes.
 * Re-running wipes this company's business data and rebuilds it; the company's
 * reference/config data is preserved.
 *
 * An email that belongs to no company bootstraps a brand new user + company
 * first, which is what `crbn up` relies on for test@carbon.ms.
 *
 * After the seed commits it runs MRP and the scheduler through
 * `@carbon/jobs`'s `plan:company` (skip with `--skip-plan`).
 *
 * Usage:
 *   pnpm run db:seed:dev -- --email your@email.com [--dataset satellite]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getPostgresConnectionPool } from "./client.ts";
import { bootstrap, DEV_PASSWORD } from "./datasets/bootstrap.ts";
import { loadEnv, parseSeedArgs } from "./datasets/cli.ts";
import { applyDataset, datasetKeys, getDataset } from "./datasets/index.ts";
import { printSummary } from "./datasets/sql.ts";
import { resolveCompany, resolveCompanyTimeZone } from "./datasets/types.ts";

loadEnv();

async function main() {
  const {
    email,
    dataset: datasetKey,
    tiers,
    skipWipe,
    skipPlan
  } = parseSeedArgs(datasetKeys());
  console.log(
    `\nSeeding development environment for: ${email} (${datasetKey})\n`
  );

  const pool = getPostgresConnectionPool(1);
  const client = await pool.connect();
  let seeded: { companyId: string; userId: string } | null = null;

  try {
    let resolved = await resolveCompany(client, email);
    if (!resolved) {
      console.log("No company for that email — bootstrapping a new one...");
      resolved = await bootstrap(client, email);
      console.log(`  Company ${resolved.companyId} created.`);
    }
    const { companyId, userId } = resolved;

    const dataset = getDataset(datasetKey);
    if (!dataset) throw new Error(`Seed: no such dataset: ${datasetKey}`);

    const timeZone = await resolveCompanyTimeZone(client, companyId);

    if (skipWipe) console.log("Skipping wipe (--skip-wipe).");

    // Dev/test convenience: enable accounting so posting flows create GL
    // journals out of the box. Runs for pre-existing companies too (the
    // bootstrap path also sets it for brand-new ones). Production keeps
    // the column default (false) — this script is dev-seed only.
    await client.query(
      `UPDATE "companySettings" SET "accountingEnabled" = true WHERE id = $1`,
      [companyId]
    );

    await applyDataset(client, {
      companyId,
      userId,
      dataset,
      timeZone,
      tiers,
      log: (message) => console.log(message),
      wipeFirst: !skipWipe
    });

    await printSummary(client, companyId);
    seeded = { companyId, userId };
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

  if (seeded && !skipPlan) planCompany(seeded);
}

// The engines reach Supabase over HTTPS; under portless that is its self-signed
// CA, which `crbn up` hands its apps the same way (packages/dev services/apps.ts).
function portlessCa(): Record<string, string> {
  const caPath = path.join(homedir(), ".portless", "ca.pem");
  return !process.env.NODE_EXTRA_CA_CERTS && existsSync(caPath)
    ? { NODE_EXTRA_CA_CERTS: caPath }
    : {};
}

// A spawned script, not an import: @carbon/planning depends on this package.
function planCompany({
  companyId,
  userId
}: {
  companyId: string;
  userId: string;
}) {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".."
  );
  const planned = spawnSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@carbon/jobs",
      "plan:company",
      "--",
      "--company",
      companyId,
      "--user",
      userId
    ],
    {
      stdio: "inherit",
      cwd: repoRoot,
      env: { ...process.env, ...portlessCa() }
    }
  );
  if (planned.status !== 0) {
    console.warn(
      `⚠ Planning step failed — run it later with: pnpm --filter @carbon/jobs plan:company -- --company ${companyId} --user ${userId}`
    );
  }
}

main();
