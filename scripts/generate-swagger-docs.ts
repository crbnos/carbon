// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renameSync, writeFileSync } from "node:fs";
import { loadDotEnv } from "./lib/local-script-config";
import { normalizeSwaggerSchema } from "./lib/swagger-schema";

async function main(): Promise<void> {
  loadDotEnv();
  // PostgREST's own OpenAPI document, through Kong with the anon key. Studio's
  // /api/platform/.../api/rest returns these exact bytes, so reading it here
  // keeps this script working when Studio isn't running.
  const apiPort = process.env.PORT_API;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!apiPort || !anonKey)
    throw new Error(
      "PORT_API / SUPABASE_ANON_KEY not set (expected in .env.local). Run `crbn up` first."
    );
  const response = await fetch(`http://127.0.0.1:${apiPort}/rest/v1/`, {
    headers: { apikey: anonKey },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok)
    throw new Error(`Swagger request failed (HTTP ${response.status})`);
  const data = normalizeSwaggerSchema(await response.json());

  // Strip per-tenant `searchIndex_<companyId>` / `auditLog_<companyId>` tables
  // (created at runtime per company) — which ones exist depends on the local
  // DB's seeded companies, so committing them makes the schema
  // machine-dependent. Their keys appear as "/<table>" paths, "<table>"
  // definitions, and "rowFilter.<table>.<col>" parameters. The static
  // "searchIndexRegistry" / "auditLogArchive" tables (no underscore) are
  // unaffected.
  const stripPerTenantKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripPerTenantKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !/(searchIndex|auditLog)_[A-Za-z0-9]/.test(key))
          .map(([key, v]) => [key, stripPerTenantKeys(v)])
      );
    }
    return value;
  };

  const output = "packages/database/src/swagger-docs-schema.ts";
  writeFileSync(
    `${output}.tmp`,
    `export default ${JSON.stringify(stripPerTenantKeys(data), null, 2)}`
  );
  renameSync(`${output}.tmp`, output);
  process.stdout.write("Swagger schema refreshed.\n");
}

main().catch((error) => {
  process.stderr.write(
    `Swagger generation failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
