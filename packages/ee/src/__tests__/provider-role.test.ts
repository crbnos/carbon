import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `providerRole` is declared in TWO places by necessity: on the integration
 * descriptor, where the application reads it, and on the `integration` table,
 * where the `companyIntegration_single_active_role` trigger reads it. A
 * descriptor declaring a role the migration never backfilled would pass every
 * type check and then silently skip the exclusivity guard — the trigger returns
 * early when the column is NULL, so the failure mode is "no enforcement", not
 * an error.
 *
 * This reads the declarations out of SOURCE rather than importing them: the
 * `@carbon/ee` barrel pulls `@carbon/auth`, which validates the full server env
 * at import time, so no test can import it. Scanning the files is what is
 * actually available, and it tests the thing that matters — what is declared
 * versus what was backfilled.
 */

const SRC = join(__dirname, "..");
const MIGRATION = join(
  __dirname,
  "../../../database/supabase/migrations/20260924133915_integration-provider-role.sql"
);

function declaredRoles(): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const dir of readdirSync(SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of ["config.tsx", "config.ts"]) {
      let source: string;
      try {
        source = readFileSync(join(SRC, dir.name, file), "utf8");
      } catch {
        continue;
      }
      const role = source.match(/providerRole:\s*"(accounting|spend)"/);
      const id = source.match(/\n\s*id:\s*"([^"]+)"/);
      if (role?.[1] && id?.[1]) roles[id[1]] = role[1];
    }
  }
  return roles;
}

function backfilledRoles(): Record<string, string> {
  const sql = readFileSync(MIGRATION, "utf8");
  const roles: Record<string, string> = {};
  for (const stmt of sql.split(/UPDATE\s+"integration"\s+SET/i).slice(1)) {
    const role = stmt.match(/"providerRole"\s*=\s*'(accounting|spend)'/);
    if (!role?.[1]) continue;
    for (const m of stmt.slice(0, stmt.indexOf(";")).matchAll(/'([a-z-]+)'/g)) {
      if (m[1] && m[1] !== role[1]) roles[m[1]] = role[1];
    }
  }
  return roles;
}

describe("providerRole", () => {
  it("declares a role for at least the four providers", () => {
    const declared = declaredRoles();
    expect(declared).toEqual({
      xero: "accounting",
      quickbooks: "accounting",
      rillet: "accounting",
      ramp: "spend"
    });
  });

  it("matches what the migration backfilled onto the registry", () => {
    // If these diverge, the trigger silently does not guard the new provider.
    expect(declaredRoles()).toEqual(backfilledRoles());
  });
});
