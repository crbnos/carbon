/**
 * MCP Tool Metadata Generator
 *
 * Writes tool-metadata.json from the shared service parser
 * (`scripts/lib/service-metadata.ts`).
 *
 * Usage: npx tsx scripts/generate-mcp.ts
 */

import * as fs from "fs";
import * as path from "path";

import {
  buildManifestDigest,
  serializeManifestDigest
} from "./lib/manifest-digest";
import {
  buildAllToolMetadataWithValidators,
  MODULE_LIST
} from "./lib/service-metadata";

const log = (message: string) => process.stdout.write(`${message}\n`);
const warn = (message: string) => process.stderr.write(`${message}\n`);

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
  log("Generating tool metadata from service files...");

  const {
    tools: allTools,
    registryStats,
    responseStats,
    resolutions
  } = await buildAllToolMetadataWithValidators({
    onModule: (mod, count) => log(`  ✓ ${mod}: ${count} tools`)
  });

  const metadata = {
    totalTools: allTools.length,
    modules: [...new Set(allTools.map((t) => t.module))].length,
    tools: allTools
  };

  // Minified: this file is gitignored build output that only machines read, and
  // response schemas roughly tripled it. The readable artifact is the digest.
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));
  fs.writeFileSync(
    DIGEST_FILE,
    serializeManifestDigest(buildManifestDigest(allTools))
  );
  log(`\n✓ Generated metadata for ${allTools.length} tools`);
  log(`  Output: ${path.relative(ROOT, METADATA_FILE)} (gitignored)`);
  log(`  Digest: ${path.relative(ROOT, DIGEST_FILE)} (committed)`);

  // Schema provenance. A validator that fell back to source-text parsing still
  // produces a manifest entry, so surface it rather than letting the degrade pass
  // silently — that fallback is the only path that can publish a lossy schema.
  const fallbacks = resolutions.filter((r) => r.how !== "native");
  log(
    `  Schemas: ${registryStats.validatorsConverted} validators converted from ${registryStats.modulesLoaded}/${MODULE_LIST.length} modules`
  );
  log(
    `  Responses: ${responseStats.derived}/${responseStats.functions} reflected from return types (${responseStats.empty} yielded nothing usable)`
  );
  if (registryStats.moduleErrors.length > 0) {
    warn(`  ⚠ ${registryStats.moduleErrors.length} module(s) failed to load:`);
    for (const e of registryStats.moduleErrors) {
      warn(`      ${e.module}: ${e.error}`);
    }
  }
  if (registryStats.conversionFailures.length > 0) {
    warn(
      `  ⚠ ${registryStats.conversionFailures.length} validator(s) failed to convert:`
    );
    for (const f of registryStats.conversionFailures.slice(0, 10)) {
      warn(`      ${f.module}.${f.name}: ${f.error}`);
    }
  }
  if (fallbacks.length > 0) {
    const unique = [...new Set(fallbacks.map((f) => f.validatorName))];
    warn(
      `  ⚠ ${fallbacks.length} param(s) used the source-text fallback: ${unique.slice(0, 12).join(", ")}`
    );
  }
}

if (require.main === module) {
  generateToolMetadata().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
