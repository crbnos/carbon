// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Fails when the committed manifest digest no longer matches what the service files
 * imply — i.e. somebody changed a validator or a service signature without running
 * `pnpm generate:mcp`.
 *
 * This is what replaces reading the manifest diff in review. The manifest itself is
 * gitignored build output, so the digest is the only committed record of the
 * published contract; if it can go stale silently, it is worth nothing.
 *
 * Usage: pnpm check:manifest
 */

import * as fs from "fs";
import * as path from "path";

import {
  buildManifestDigest,
  diffDigests,
  formatDigestDiff,
  type ManifestDigest,
} from "./lib/manifest-digest";
import { buildAllToolMetadataWithValidators } from "./lib/service-metadata";

const ROOT = path.resolve(__dirname, "..");
const DIGEST_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json"
);

async function main(): Promise<void> {
  if (!fs.existsSync(DIGEST_FILE)) {
    console.error(
      `check-manifest: ${path.relative(ROOT, DIGEST_FILE)} is missing — run \`pnpm generate:mcp\`.`
    );
    process.exit(1);
  }

  const committed = JSON.parse(
    fs.readFileSync(DIGEST_FILE, "utf-8")
  ) as ManifestDigest;

  const { tools, registryStats } = await buildAllToolMetadataWithValidators();
  const fresh = buildManifestDigest(tools);

  const diff = diffDigests(committed, fresh);
  const drifted =
    diff.added.length + diff.removed.length + diff.changed.length > 0;

  if (!drifted) {
    console.log(
      `check-manifest: ok — ${fresh.totalTools} operations across ${fresh.modules} modules, digest current.`
    );
    // A module that will not load no longer degrades to source-text parsing — the
    // schemas it should have contributed are simply absent, so the digest being
    // current says nothing about whether it is complete.
    if (registryStats.moduleErrors.length > 0) {
      console.error(
        `  ✗ ${registryStats.moduleErrors.length} module(s) failed to load, so their schemas are missing:`
      );
      for (const e of registryStats.moduleErrors) {
        console.error(`      ${e.module}: ${e.error}`);
      }
      process.exit(1);
    }
    return;
  }

  console.error("check-manifest: the committed digest is stale.\n");
  console.error(formatDigestDiff(diff));
  console.error(
    `\n${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed.`
  );
  console.error("\nRun `pnpm generate:mcp` and commit the digest.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
