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
// a second run writes nothing. A company whose own data refuses the repair (a
// closed period, an empty account default, no user) is skipped: it is listed
// at the end, the run goes on, and the script still exits 0, so one company
// cannot fail every deploy. Settings → Accounting offers the same repair for
// it once its data is fixed. Any other failure (a server error, a bug, a lost
// connection) is `failed`: the script exits 1, so the ledger row is not
// written and the next deploy retries.
//
// Needs a Postgres connection: SUPABASE_DB_URL, which the migrations runner
// passes to one-off scripts (the project's IPv4 Supavisor URL, see
// scripts/one-off/README.md).
// A workspace with no Postgres URL defers the script: it logs why and exits
// with ONE_OFF_SCRIPT_DEFERRED (75, ci/src/one-off-scripts.ts), so the runner
// records nothing and runs it again on the next deploy, without failing this
// one.
//
// Safe to remove once every deployment has run it.
//
// Usage:
//   pnpm exec tsx scripts/one-off/journal-legacy-documents.ts            # write
//   pnpm exec tsx scripts/one-off/journal-legacy-documents.ts --dry-run  # read-only

import { createRequire } from "node:module";
import { readLocalScriptConfig } from "../lib/local-script-config";

const isDryRun = process.argv.includes("--dry-run");
/** ONE_OFF_SCRIPT_DEFERRED in ci/src/one-off-scripts.ts. */
const DEFERRED = 75;

let SUPABASE_DB_URL: string;
try {
  ({ SUPABASE_DB_URL } = readLocalScriptConfig(
    ["SUPABASE_DB_URL"],
    process.env
  ));
} catch (error) {
  console.warn(
    `journal-legacy-documents deferred: ${error instanceof Error ? error.message : String(error)} The workspace has no Postgres URL (a pooler URL or a postgresql:// connection string); add one and the next deploy runs it.`
  );
  process.exit(DEFERRED);
}
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
        } else if (outcome.status === "skipped") {
          console.warn(`${outcome.companyId}: skipped, ${outcome.reason}`);
        } else {
          console.error(`${outcome.companyId}: FAILED ${outcome.error}`);
        }
      }
    });
    const failed = outcomes.filter((outcome) => outcome.status === "failed");
    const skipped = outcomes.flatMap((outcome) =>
      outcome.status === "skipped" ? [outcome] : []
    );
    console.log(
      `${outcomes.length} compan${outcomes.length === 1 ? "y" : "ies"} with legacy documents; ${skipped.length} skipped; ${failed.length} failed.`
    );
    if (skipped.length > 0) {
      console.warn(
        "Skipped companies need attention: fix the reason, then use Settings → Accounting → Write missing journals."
      );
      for (const outcome of skipped) {
        console.warn(`  ${outcome.companyId}: ${outcome.reason}`);
      }
    }
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
