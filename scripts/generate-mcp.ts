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
import { buildAllToolMetadataWithValidators } from "./lib/service-metadata";

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
  console.log("Generating tool metadata from service files...");

  const { tools: allTools, registryStats, responseStats, resolutions } =
    await buildAllToolMetadataWithValidators({
      onModule: (mod, count) => console.log(`  ✓ ${mod}: ${count} tools`),
    });

  const metadata = {
    generated: new Date().toISOString(),
    totalTools: allTools.length,
    modules: [...new Set(allTools.map((t) => t.module))].length,
    tools: allTools,
  };

  // Minified: this file is gitignored build output that only machines read, and
  // response schemas roughly tripled it. The readable artifact is the digest.
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));
  fs.writeFileSync(
    DIGEST_FILE,
    serializeManifestDigest(buildManifestDigest(allTools))
  );
  console.log(`\n✓ Generated metadata for ${allTools.length} tools`);
  console.log(`  Output: ${path.relative(ROOT, METADATA_FILE)} (gitignored)`);
  console.log(`  Digest: ${path.relative(ROOT, DIGEST_FILE)} (committed)`);

  // Schema provenance. A validator that fell back to source-text parsing still
  // produces a manifest entry, so surface it rather than letting the degrade pass
  // silently — that fallback is the only path that can publish a lossy schema.
  const fallbacks = resolutions.filter((r) => r.how !== "native");
  console.log(
    `  Schemas: ${registryStats.validatorsConverted} validators converted from ${registryStats.modulesLoaded}/15 modules`
  );
  console.log(
    `  Responses: ${responseStats.derived}/${responseStats.functions} reflected from return types (${responseStats.empty} yielded nothing usable)`
  );
  if (registryStats.moduleErrors.length > 0) {
    console.warn(`  ⚠ ${registryStats.moduleErrors.length} module(s) failed to load:`);
    for (const e of registryStats.moduleErrors) {
      console.warn(`      ${e.module}: ${e.error}`);
    }
  }
  if (registryStats.conversionFailures.length > 0) {
    console.warn(
      `  ⚠ ${registryStats.conversionFailures.length} validator(s) failed to convert:`
    );
    for (const f of registryStats.conversionFailures.slice(0, 10)) {
      console.warn(`      ${f.module}.${f.name}: ${f.error}`);
    }
  }
  if (fallbacks.length > 0) {
    const unique = [...new Set(fallbacks.map((f) => f.validatorName))];
    console.warn(
      `  ⚠ ${fallbacks.length} param(s) used the source-text fallback: ${unique.slice(0, 12).join(", ")}`
    );
  }
}

if (require.main === module) {
  generateToolMetadata().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
