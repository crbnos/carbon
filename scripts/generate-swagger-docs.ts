import { writeFileSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const studioPort = process.env.PORT_STUDIO;
if (!studioPort) {
  console.error(
    "PORT_STUDIO not set (expected in .env.local). Run `pnpm dev:up` first."
  );
  process.exit(1);
}

const url = `http://localhost:${studioPort}/api/platform/projects/default/api/rest`;

(async () => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

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

  writeFileSync(
    "packages/database/src/swagger-docs-schema.ts",
    `export default ${JSON.stringify(stripPerTenantKeys(data), null, 2)}`
  );
})();
