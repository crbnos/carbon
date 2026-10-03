// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * MCP Tool Metadata Generator
 *
 * Writes tool-metadata.json from the shared service parser
 * (`scripts/lib/service-metadata.ts`).
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
import {
  buildAllToolMetadataWithValidators,
  MODULE_LIST
} from "./lib/service-metadata";

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

  const auditDrops: { toolName: string; table: string; dropped: string[] }[] =
    [];
  const untagged: string[] = [];
  const skippedModules: { module: string; functionCount: number }[] = [];

  const { tools: allTools, registryStats, responseStats, resolutions } =
    await buildAllToolMetadataWithValidators({
      onModule: (mod, count) => console.log(`  ✓ ${mod}: ${count} tools`),
      onAuditColumnsDropped: (toolName, table, dropped) =>
        auditDrops.push({ toolName, table, dropped }),
      onUntagged: (toolName) => untagged.push(toolName),
      onModuleSkipped: (module, functionCount) =>
        skippedModules.push({ module, functionCount }),
    });

  // Refuse BEFORE writing. Every `z.infer` param must resolve NATIVELY — the
  // real validator, converted by zod itself. There is no longer a source-text
  // fallback to absorb a module that will not load: it published a lossy
  // contract, and measured over the real tree it never once fired. A manifest
  // with `{}` where a real schema belongs invites an MCP client to guess field
  // names, and a guessed field reaches the insert and fails with PGRST204 — so
  // leaving the previous good manifest in place beats overwriting it with one
  // nobody can trust.
  const unresolved = resolutions.filter((r) => r.how !== "native");
  const failures: string[] = [];
  if (registryStats.moduleErrors.length > 0) {
    console.error(
      `\n  ✗ ${registryStats.moduleErrors.length} module(s) failed to load:`
    );
    for (const e of registryStats.moduleErrors) {
      console.error(`      ${e.module}: ${e.error}`);
    }
    failures.push(
      `${registryStats.moduleErrors.length} module(s) failed to load`
    );
  }
  if (unresolved.length > 0) {
    const unique = [...new Set(unresolved.map((f) => f.validatorName))];
    console.error(
      `\n  ✗ ${unresolved.length} param(s) could not resolve their validator: ${unique.slice(0, 12).join(", ")}`
    );
    failures.push(`${unresolved.length} param(s) have no validator schema`);
  }
  if (failures.length > 0) {
    throw new Error(
      `generate:mcp refused to publish a lossy manifest — ${failures.join("; ")}. Nothing was written.`
    );
  }

  // No timestamp: the file must be a pure function of the sources so repeated
  // runs on an unchanged tree are byte-identical.
  // The tables a tenant's rows live in. The dispatcher filters every update
  // and delete on one of them by the caller's company (`scopedToCompany`), so
  // a list that came back empty would switch that off without a sound.
  const companyTables = getDbTablesWithColumn("companyId");
  if (!companyTables.includes("customer") || companyTables.length < 100) {
    throw new Error(
      `generate:mcp found only ${companyTables.length} tables with a companyId column in the generated database types; the dispatcher's company filter depends on that list. Nothing was written.`
    );
  }

  const metadata = {
    totalTools: allTools.length,
    modules: [...new Set(allTools.map((t) => t.module))].length,
    companyTables,
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

  // Exposure. A function reaches the API because its doc comment declares
  // `@mcp <verb>`, not because it is exported — see mcp-exposure.ts.
  if (skippedModules.length > 0) {
    console.log(
      `\n  Modules not on MCP_MODULE_ALLOWLIST: ${skippedModules.map((m) => `${m.module} (${m.functionCount} fns)`).join(", ")}`
    );
  }
  if (untagged.length > 0) {
    console.log(
      `\n  Exported but not exposed (no @mcp tag): ${untagged.length}`
    );
  }

  // Audit-column provenance. A `create`/`update`/`upsert` tool is handed
  // createdBy/updatedBy, and dispatch stamps them onto the payload OBJECT — so a
  // service that spreads its argument into the write would send a column the
  // table does not have (PGRST204). Each drop below is the verb's set being
  // corrected against the generated types; a drop that looks wrong means the
  // table really does have the column, or the tool needs an `@mcp audit` line.
  if (auditDrops.length > 0) {
    console.log(
      `\n  Audit columns dropped (absent from the tool's table): ${auditDrops.length}`
    );
    for (const d of auditDrops) {
      console.log(`      ${d.toolName} → ${d.table}: ${d.dropped.join(", ")}`);
    }
  }

  console.log(
    `  Schemas: ${registryStats.validatorsConverted} validators converted from ${registryStats.modulesLoaded}/${MODULE_LIST.length} modules`
  );
  console.log(
    `  Responses: ${responseStats.derived}/${responseStats.functions} reflected from return types (${responseStats.empty} yielded nothing usable)`
  );
  if (registryStats.conversionFailures.length > 0) {
    console.warn(
      `  ⚠ ${registryStats.conversionFailures.length} validator(s) failed to convert:`
    );
    for (const f of registryStats.conversionFailures.slice(0, 10)) {
      console.warn(`      ${f.module}.${f.name}: ${f.error}`);
    }
  }
}

if (require.main === module) {
  generateToolMetadata().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
