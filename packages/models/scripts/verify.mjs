// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { packageDir, readCoverage, repoRoot } from "./coverage.mjs";

/**
 * Runs each model and the database tests that reproduce its counterexamples on
 * the real code. A database test skips without a local database, and a skip
 * would read as a pass here, so both are refused.
 */

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];
const url = process.env.SUPABASE_DB_URL;
let host = null;
try {
  host = url ? new URL(url).hostname : null;
} catch {}
if (!host || !LOCAL.includes(host)) {
  console.error(
    "SUPABASE_DB_URL must name the local database (copy it from .env.local): without it the database tests skip."
  );
  process.exit(1);
}

const wanted = process.argv.slice(2);
const coverage = readCoverage();
const models = wanted.length > 0 ? wanted : Object.keys(coverage);

function run(cwd, files) {
  const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files], {
    cwd,
    encoding: "utf8",
    env: process.env
  });
  const output = `${result.stdout}${result.stderr}`;
  const summary = output.match(/Tests\s+.*\)/)?.[0] ?? "no test summary";
  const skipped = /\d+ skipped/.test(summary);
  return { ok: result.status === 0 && !skipped, summary };
}

/**
 * A database test path is relative to apps/erp, or names its package
 * (`packages/<name>/<path>`) when the code it runs lives outside the ERP: it
 * runs from there.
 */
function databaseRuns(tests) {
  const byDir = new Map();
  for (const test of tests) {
    const inPackage = test.match(/^(packages\/[^/]+)\/(.+)$/);
    const dir = join(repoRoot, inPackage ? inPackage[1] : "apps/erp");
    byDir.set(dir, [...(byDir.get(dir) ?? []), inPackage ? inPackage[2] : test]);
  }
  return [...byDir];
}

let failed = false;
for (const name of models) {
  const model = coverage[name];
  if (!model) {
    console.error(`${name}: not in coverage.json`);
    failed = true;
    continue;
  }
  const checks = [
    ["model", run(packageDir, [model.model.replace(/\.ts$/, ".test.ts")])],
    ...databaseRuns(model.databaseTests).map(([dir, files]) => [
      "database",
      run(dir, files)
    ])
  ];
  for (const [label, check] of checks) {
    console.log(`${name} ${label}: ${check.ok ? "ok" : "FAILED"} (${check.summary})`);
    if (!check.ok) failed = true;
  }
}
process.exit(failed ? 1 : 0);
