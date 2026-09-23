/**
 * Runs MRP and the scheduler over one company, as the demo template job does
 * after applying a dataset. `db:seed:dev` spawns this after its seed commits —
 * `@carbon/database` cannot import `@carbon/planning` (it depends on the database).
 *
 * Best-effort: exits 0 even when a step fails; 1 only on bad arguments.
 *
 * Usage:
 *   pnpm --filter @carbon/jobs plan:company -- --company <id> --user <id>
 */

import { createRequire } from "node:module";
import process from "node:process";
import { parseArgs } from "node:util";

// Loaded through require so tsx compiles the whole graph as CJS: as ESM, the
// named imports @carbon/planning takes from @carbon/database (a CJS package)
// fail to link under plain tsx.
const { planDemoCompany } = createRequire(import.meta.url)(
  "../demo-planning"
) as typeof import("../demo-planning");

function printUsage() {
  console.log(`
Usage: pnpm --filter @carbon/jobs plan:company -- --company <id> --user <id>

Runs MRP, then the scheduler for every location with Ready / In Progress /
Paused jobs. Failures are reported but never fail the command.
Under portless, prefix NODE_EXTRA_CA_CERTS=~/.portless/ca.pem (db:seed:dev does).

Arguments:
  --company   Required. The company to plan.
  --user      Required. The user recorded as creator of the planning rows.
`);
}

async function main() {
  let values: { company?: string; user?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2).filter((a) => a !== "--"),
      options: {
        company: { type: "string" },
        user: { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      },
      strict: true
    }));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    printUsage();
    return 1;
  }

  if (values.help) {
    printUsage();
    return 0;
  }

  const companyId = values.company?.trim();
  const userId = values.user?.trim();
  if (!companyId || !userId) {
    console.error("Error: --company and --user are required");
    printUsage();
    return 1;
  }

  console.log(`\nPlanning company ${companyId}...`);
  const result = await planDemoCompany({ companyId, userId });

  console.log(result.mrp === "ok" ? "  MRP ✓" : `  MRP ✗ ${result.mrp}`);
  if (result.schedule.length === 0) {
    console.log("  Schedule — no Ready / In Progress / Paused jobs");
  }
  for (const { locationId, result: outcome } of result.schedule) {
    console.log(
      outcome === "ok"
        ? `  Schedule ${locationId} ✓`
        : `  Schedule ${locationId} ✗ ${outcome}`
    );
  }
  return 0;
}

main()
  .catch((err) => {
    console.error(`  Planning ✗ ${err instanceof Error ? err.message : err}`);
    return 0;
  })
  // Explicit exit: the shared pg pool keeps the event loop alive.
  .then((code) => process.exit(code));
