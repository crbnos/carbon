// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One-off, idempotent: writes the missing journals of legacy documents for
// every company with an accounting cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a). A company enabled
// before the enable wrote them, and every demo-template company (migration
// 20261009004448 backfilled its cutover; no enable runs for it), can hold
// posted documents dated on or after its cutover with no journal, and a
// payment against one fails. Each company runs `journal-legacy-documents` in
// its own transaction, as the user who set up accounting (else an Admin).
//
// Idempotent: the detection finds only documents still without a journal, so
// a second run writes nothing. A company that fails (a closed period, no
// user) is logged and the run goes on; the script then exits non-zero, so the
// ledger row is not written and the next deploy retries.
//
// Needs a Postgres connection: SUPABASE_DB_URL, which the migrations runner
// passes to one-off scripts (the workspace's pooler URL, as the app gets it).
//
// Safe to remove once every deployment has run it.
//
// Usage:
//   pnpm exec tsx scripts/one-off/journal-legacy-documents.ts            # write
//   pnpm exec tsx scripts/one-off/journal-legacy-documents.ts --dry-run  # read-only

import { createRequire } from "node:module";
import { readLocalScriptConfig } from "../lib/local-script-config";

const isDryRun = process.argv.includes("--dry-run");

const { SUPABASE_DB_URL } = readLocalScriptConfig(
  ["SUPABASE_DB_URL"],
  process.env
);
// The process pool reads it from the environment.
process.env.SUPABASE_DB_URL = SUPABASE_DB_URL;

// Loaded through require so tsx compiles the server code as CJS, as
// packages/jobs/src/scripts/plan-company.ts does: as ESM, the named imports
// it takes from CJS workspace packages fail to link.
const fromHere = createRequire(import.meta.url);
const { getPostgresClient, getProcessPool } = fromHere(
  "../../packages/database/src/client"
) as typeof import("../../packages/database/src/client");
// The database workspace declares and pins kysely; root scripts do not.
const { PostgresDriver } = createRequire(
  new URL("../../packages/database/package.json", import.meta.url)
)("kysely");
const { journalLegacyDocumentsForAllCompanies } = fromHere(
  "../../packages/server-functions/src/journal-legacy-documents/companies"
) as typeof import("../../packages/server-functions/src/journal-legacy-documents/companies");

const nonZero = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, count]) => count !== 0)
    .map(([family, count]) => `${family}=${count}`)
    .join(" ");

async function main(): Promise<number> {
  const pool = getProcessPool();
  const db = getPostgresClient(pool, PostgresDriver);
  try {
    console.log(
      isDryRun
        ? "Dry run: listing companies with legacy documents, writing nothing."
        : "Writing the missing journals of legacy documents."
    );
    const outcomes = await journalLegacyDocumentsForAllCompanies(db, {
      dryRun: isDryRun,
      onOutcome: (outcome) => {
        if (outcome.status === "found") {
          console.log(`${outcome.companyId}: ${nonZero(outcome.counts)}`);
        } else if (outcome.status === "written") {
          console.log(
            `${outcome.companyId}: wrote ${nonZero(outcome.journals) || "nothing"}`
          );
        } else {
          console.error(`${outcome.companyId}: FAILED ${outcome.error}`);
        }
      }
    });
    const failed = outcomes.filter((outcome) => outcome.status === "failed");
    console.log(
      `${outcomes.length} compan${outcomes.length === 1 ? "y" : "ies"} with legacy documents; ${failed.length} failed.`
    );
    return failed.length > 0 ? 1 : 0;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("journal-legacy-documents failed", error);
    process.exit(1);
  });
