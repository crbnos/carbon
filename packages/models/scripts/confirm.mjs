// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  fingerprints,
  packageDir,
  readCoverage,
  repoRoot,
  writeCoverage
} from "./coverage.mjs";

/**
 * Records the code as it reads now as confirmed for the named models, but only
 * after verify passes for them: the record never moves ahead of a check.
 */

const models = process.argv.slice(2);
if (models.length === 0) {
  console.error("Name the models to confirm: pnpm --filter @carbon/models confirm <model>…");
  process.exit(1);
}

const verify = spawnSync(
  process.execPath,
  [join(packageDir, "scripts/verify.mjs"), ...models],
  { stdio: "inherit", env: process.env }
);
if (verify.status !== 0) {
  console.error("verify failed: nothing confirmed.");
  process.exit(1);
}

const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const coverage = readCoverage();
for (const name of models) {
  coverage[name].fingerprints = fingerprints(coverage[name]);
  coverage[name].confirmedAt = head;
  console.log(`${name}: confirmed at ${head}`);
}
writeCoverage(coverage);
