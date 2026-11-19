// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Adds the second Admin (`devSecondAdminEmail`) to the dev company of an
 * already seeded user, without touching its data. `crbn up` runs it on a
 * stack seeded before the second Admin existed; a full `db:seed:dev` adds it
 * on its own.
 *
 * Usage:
 *   pnpm --filter @carbon/database db:seed:dev:admin -- --email test@carbon.ms
 */

import process from "node:process";
import { parseArgs } from "node:util";
import { getProcessPool } from "./client.ts";
import { devSecondAdminEmail, ensureDevAdmin } from "./datasets/bootstrap.ts";
import { loadEnv } from "./datasets/cli.ts";
import { resolveCompany } from "./datasets/types.ts";

loadEnv();

async function main() {
  const { values } = parseArgs({
    // `pnpm run x -- --email` passes the `--` through (as `parseSeedArgs`).
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: { email: { type: "string", short: "e" } },
    strict: true
  });
  const email = values.email?.trim();
  if (!email) {
    console.error("Error: --email is required");
    process.exitCode = 1;
    return;
  }

  const pool = getProcessPool();
  const client = await pool.connect();
  try {
    const resolved = await resolveCompany(client, email);
    if (!resolved) {
      throw new Error(`No company for ${email}: run db:seed:dev first`);
    }
    const secondAdminEmail = devSecondAdminEmail(email);
    await ensureDevAdmin(client, {
      companyId: resolved.companyId,
      email: secondAdminEmail,
      firstName: "Second",
      lastName: "Admin"
    });
    console.log(`Second Admin ${secondAdminEmail} is in ${resolved.companyId}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
