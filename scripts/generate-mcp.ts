// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * MCP Tool Metadata Generator
 *
 * Writes tool-metadata.json from the service functions the ERP router
 * publishes (`scripts/lib/service-fn-metadata.ts`).
 *
 * Usage: npx tsx scripts/generate-mcp.ts
 */

import * as fs from "fs";
import { getDbTablesWithColumn } from "./lib/db-types";
import * as path from "path";

import {
  buildManifestDigest,
  serializeManifestDigest
} from "./lib/manifest-digest";
import { buildManifest } from "./lib/service-fn-metadata";

const ROOT = path.resolve(__dirname, "..");
const METADATA_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json"
);
/**
 * Committed companion to the (gitignored) manifest — see `lib/manifest-digest.ts`.
 * Small enough to read in a diff, so a schema regression is still visible in review.
 */
export const DIGEST_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json"
);

export async function generateToolMetadata(): Promise<void> {
  console.log("Generating tool metadata from the service functions...");
  const tools = buildManifest();

  // The tables a tenant's rows live in. Every update and delete an API caller
  // makes on one of them is filtered by the caller's company
  // (`scopedToCompany`), so a list that came back empty would switch that off
  // without a sound.
  const companyTables = getDbTablesWithColumn("companyId");
  if (!companyTables.includes("customer") || companyTables.length < 100) {
    throw new Error(
      `generate:mcp found only ${companyTables.length} tables with a companyId column in the generated database types; the company filter depends on that list. Nothing was written.`
    );
  }

  // No timestamp: the file must be a pure function of the sources so repeated
  // runs on an unchanged tree are byte-identical. Minified: this file is
  // gitignored build output that only machines read; the readable artifact is
  // the digest.
  const metadata = {
    totalTools: tools.length,
    modules: [...new Set(tools.map((t) => t.module))].length,
    companyTables,
    tools
  };
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));
  fs.writeFileSync(DIGEST_FILE, serializeManifestDigest(buildManifestDigest(tools)));
  console.log(`✓ Generated metadata for ${tools.length} tools across ${metadata.modules} modules`);
  console.log(`  Output: ${path.relative(ROOT, METADATA_FILE)} (gitignored)`);
  console.log(`  Digest: ${path.relative(ROOT, DIGEST_FILE)} (committed)`);
}

if (require.main === module) {
  generateToolMetadata().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
