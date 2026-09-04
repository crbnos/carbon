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

import { buildAllToolMetadata } from "./lib/service-metadata";

const ROOT = path.resolve(__dirname, "..");
const METADATA_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json"
);

export function generateToolMetadata(): void {
  console.log("Generating tool metadata from service files...");

  const allTools = buildAllToolMetadata({
    onModule: (mod, count) => console.log(`  ✓ ${mod}: ${count} tools`),
  });

  const metadata = {
    generated: new Date().toISOString(),
    totalTools: allTools.length,
    modules: [...new Set(allTools.map((t) => t.module))].length,
    tools: allTools,
  };

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\n✓ Generated metadata for ${allTools.length} tools`);
  console.log(`  Output: ${path.relative(ROOT, METADATA_FILE)}`);
}

if (require.main === module) {
  generateToolMetadata();
}
