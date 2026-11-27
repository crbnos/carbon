// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GENERATED_AUTHZ_MIGRATION,
  migrationsDir,
  repoRoot
} from "../../sources/migrations";
import { noModulePermissionKey } from "./no-module-permission-key";

const LAST_MODULE_KEY_MIGRATION = noModulePermissionKey.provenance?.since ?? "";

const MODULE_KEY_MIGRATIONS: string[] = JSON.parse(
  readFileSync(join(__dirname, "../module-key-migrations.json"), "utf8")
);

const ROUTE = "apps/erp/app/routes/x+/inventory+/receipts.tsx";

const scanKeys = (contents: string, file = ROUTE) =>
  noModulePermissionKey
    .find({ migrations: [], functions: [], typescript: [{ file, contents }] })
    .map((v) => v.snippet);

describe("no-module-permission-key — TypeScript", () => {
  it("flags a module key string", () => {
    expect(scanKeys(`holds(claims, "inventory_view", companyId);`)).toEqual([
      '"inventory_view"'
    ]);
  });

  it("flags a gate keyed by a module, in each gate shape", () => {
    expect(
      scanKeys(`await authorize(request, { inventory: "Edit" });`)
    ).toEqual(["inventory:"]);
    expect(
      scanKeys(`await authorize(request, { view: "inventory" });`)
    ).toEqual(['"inventory"']);
    expect(scanKeys(`permissions.has({ "sales": "View" })`)).toEqual([
      '"sales":'
    ]);
    expect(
      scanKeys(
        `hasPermission(claims.permissions, "sales", "update", companyId)`
      )
    ).toEqual(['"sales"']);
    expect(
      scanKeys(
        `export const x = defineServiceFn({\n  permission: { parts: "Edit" },\n  run() {}\n});`
      )
    ).toEqual(["parts:"]);
  });

  it("flags a workflow catalog permission naming a module", () => {
    const file = "packages/ee/src/workflows/catalog/actions.ts";
    expect(
      scanKeys(`permission: { module: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
    expect(
      scanKeys(`permission: { page: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
  });

  it("passes page keys, page gates and the rules that are not gates", () => {
    expect(
      scanKeys(
        [
          `await authorize(request, { "inventory.receipts": "Edit" });`,
          `permissions.has({ "sales.quotes": "Edit" });`,
          `await authorize(request, anyOf(pagesOf("sales"), "View"));`,
          `holds(claims, "inventory.receipts_update", companyId);`,
          `permission: { page: "production.jobs", action: "create" },`,
          `permission: "employee",`,
          `permission: anyOfRule("item", "Edit"),`,
          `permissions.has({ documents: "View" });`,
          `const key = "documents_view";`,
          `columnCaps={{ accounting: "Edit" }}`
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("ignores comments", () => {
    expect(
      scanKeys(
        `// the old gate was { view: "sales" } and "sales_view"\nconst a = 1;`
      )
    ).toEqual([]);
  });

  it("skips a portal rule's own key, and scans the rest of the manifest", () => {
    expect(
      scanKeys(
        `widget: company({ read: or(portal.customer("customerId", "sales_view"), "inventory_view") }),`,
        "packages/database/src/authz/manifest.ts"
      )
    ).toEqual(['"inventory_view"']);
  });
});

describe("no-module-permission-key — SQL", () => {
  const after = `${String(Number(LAST_MODULE_KEY_MIGRATION) + 1)}_x.sql`;

  it("leaves the migrations that existed at the cutoff alone", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        `${LAST_MODULE_KEY_MIGRATION}_module-keys-to-pages.sql`
      )
    ).toEqual([]);
  });

  // An open branch can land a migration dated before the cutoff after it.
  it("flags a migration dated before the cutoff that was not there at the cutoff", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        "packages/database/supabase/migrations/20261001120000_late-branch.sql"
      )
    ).toEqual(["settings_update"]);
  });

  // A migration listed after the cutoff was merged from main. It must be a
  // generated authz migration: @carbon/database's migration.test.ts (`unshipped`)
  // then fails unless a later generated migration re-ships its tables.
  it("lists, after the cutoff, only generated authz migrations", () => {
    const dir = migrationsDir(repoRoot());
    const late = MODULE_KEY_MIGRATIONS.filter(
      (name) => name.slice(0, 14) > LAST_MODULE_KEY_MIGRATION
    );
    for (const name of late) {
      const firstLine = readFileSync(join(dir, name), "utf8").split("\n")[0];
      expect(firstLine, name).toBe(GENERATED_AUTHZ_MIGRATION);
    }
  });

  it("flags a managed function file whatever its age", () => {
    expect(
      scanKeys(
        [
          "CREATE FUNCTION get_audit_log(p_company_id TEXT) RETURNS void LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  PERFORM assert_audit_log_access(p_company_id, 'settings_view');",
          "  PERFORM 1 FROM pg_policies p WHERE p.qual LIKE '%settings_view%';",
          "END $$;"
        ].join("\n"),
        "packages/database/src/event-system/functions/get_audit_log.sql"
      )
    ).toEqual(["settings_view", "settings_view"]);
  });

  it("passes page keys, portal keys and comments", () => {
    expect(
      scanKeys(
        [
          `-- the old key was settings_view`,
          `SELECT get_companies_with_employee_permission('settings.auditLogs_view');`,
          `SELECT get_customer_ids_with_customer_permission('parts_view');`,
          `SELECT get_supplier_ids_with_supplier_permission('parts_update');`,
          `SELECT format('SELECT get_companies_with_employee_permission(''documents_view'')');`
        ].join("\n"),
        after
      )
    ).toEqual([]);
  });
  it("skips SQL that is neither a migration nor a managed function file", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        "apps/erp/app/modules/settings/report.sql"
      )
    ).toEqual([]);
  });
});
