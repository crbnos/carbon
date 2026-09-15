import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import {
  normalizeSwaggerSchema,
  PARTNER_ALIAS_PROOF_SQL
} from "./lib/swagger-schema";

async function responseJson(
  response: Response,
  label: string
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} response is not valid JSON`);
  }
}

async function main(): Promise<void> {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(file, "utf8"))
    )) {
      if (file === ".env.local" || process.env[key] === undefined)
        process.env[key] = value;
    }
  }
  const studioPort = process.env.PORT_STUDIO;
  if (
    !studioPort ||
    !/^\d+$/.test(studioPort) ||
    Number(studioPort) < 1 ||
    Number(studioPort) > 65535
  )
    throw new Error(
      "PORT_STUDIO must identify a local Studio port; start the development stack first"
    );
  const studio = `http://127.0.0.1:${studioPort}`;
  const response = await fetch(
    `${studio}/api/platform/projects/default/api/rest`,
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok)
    throw new Error(`Swagger request failed (HTTP ${response.status})`);
  const raw = await responseJson(response, "Swagger");
  const proofResponse = await fetch(
    `${studio}/api/platform/pg-meta/default/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: PARTNER_ALIAS_PROOF_SQL }),
      signal: AbortSignal.timeout(30_000)
    }
  );
  if (!proofResponse.ok)
    throw new Error(
      `Schema proof request failed (HTTP ${proofResponse.status})`
    );
  const data = normalizeSwaggerSchema(
    raw,
    await responseJson(proofResponse, "Schema proof")
  );

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
  const temporary = mkdtempSync(join(dirname(output), ".swagger-generation-"));
  try {
    const candidate = join(temporary, "schema.ts");
    writeFileSync(
      candidate,
      `export default ${JSON.stringify(stripPerTenantKeys(data), null, 2)}`
    );
    renameSync(candidate, output);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write(
    "Swagger schema refreshed with verified partner alias metadata.\n"
  );
}

main().catch((error) => {
  process.stderr.write(
    `Swagger generation failed: ${error instanceof Error ? error.message : "verification did not complete"}\n`
  );
  process.exitCode = 1;
});
