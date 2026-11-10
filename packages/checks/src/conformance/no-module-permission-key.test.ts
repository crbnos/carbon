// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LAST_MODULE_KEY_MIGRATION,
  MODULE_KEY_MIGRATIONS,
  noModulePermissionKey
} from "./no-module-permission-key";

const ROUTE = "apps/erp/app/routes/x+/inventory+/receipts.tsx";
// The generated migration that re-ships every table's policies with page keys.
const PAGE_PERMISSIONS_MIGRATION = readdirSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../database/supabase/migrations"
  )
)
  .filter((name) => name.endsWith("_page-permissions.sql"))
  .sort()
  .at(-1)
  ?.slice(0, 14);

const scan = (contents: string, file = ROUTE) =>
  noModulePermissionKey.scan(file, contents).map((v) => v.snippet);

describe("no-module-permission-key — TypeScript", () => {
  it("flags a module key string", () => {
    expect(scan(`holds(claims, "inventory_view", companyId);`)).toEqual([
      '"inventory_view"'
    ]);
  });

  it("flags a gate keyed by a module, in each gate shape", () => {
    expect(scan(`await authorize(request, { inventory: "Edit" });`)).toEqual([
      "inventory:"
    ]);
    expect(scan(`await authorize(request, { view: "inventory" });`)).toEqual([
      '"inventory"'
    ]);
    expect(scan(`permissions.has({ "sales": "View" })`)).toEqual(['"sales":']);
    expect(
      scan(`hasPermission(claims.permissions, "sales", "update", companyId)`)
    ).toEqual(['"sales"']);
    expect(
      scan(
        `export const x = defineServiceFn({\n  permission: { parts: "Edit" },\n  run() {}\n});`
      )
    ).toEqual(["parts:"]);
  });

  it("flags a workflow catalog permission naming a module", () => {
    const file = "packages/ee/src/workflows/catalog/actions.ts";
    expect(
      scan(`permission: { module: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
    expect(
      scan(`permission: { page: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
  });

  it("passes page keys, page gates and the rules that are not gates", () => {
    expect(
      scan(
        [
          `await authorize(request, { "inventory.receipts": "Edit" });`,
          `permissions.has({ "sales.quotes": "Edit" });`,
          `permissions.hasAny("inventory", "View");`,
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
      scan(
        `// the old gate was { view: "sales" } and "sales_view"\nconst a = 1;`
      )
    ).toEqual([]);
  });

  it("skips a portal rule's own key, and scans the rest of the manifest", () => {
    expect(
      scan(
        `widget: company({ read: or(portal.customer("customerId", "sales_view"), "inventory_view") }),`,
        "packages/database/src/authz/manifest.ts"
      )
    ).toEqual(['"inventory_view"']);
  });
});

describe("no-module-permission-key — SQL", () => {
  const after = `${String(Number(LAST_MODULE_KEY_MIGRATION) + 1)}_x.sql`;

  it("flags a module key in a migration after the cutoff", () => {
    expect(
      scan(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        after
      )
    ).toEqual(["settings_update"]);
  });

  it("leaves the migrations that existed at the cutoff alone", () => {
    expect(
      scan(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        `${LAST_MODULE_KEY_MIGRATION}_module-keys-to-pages.sql`
      )
    ).toEqual([]);
    expect(
      MODULE_KEY_MIGRATIONS.has("20260927224314_retire-legacy-rls-helpers.sql")
    ).toBe(true);
  });

  // An open branch can land a migration dated before the cutoff after it.
  it("flags a migration dated before the cutoff that was not there at the cutoff", () => {
    expect(
      scan(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        "packages/database/supabase/migrations/20261001120000_late-branch.sql"
      )
    ).toEqual(["settings_update"]);
  });

  it("lists only migrations the page-permissions migration re-ships", () => {
    // At or before the cutoff, or merged from main later and sorting before
    // the generated page-permissions migration, which re-ships their tables.
    expect(PAGE_PERMISSIONS_MIGRATION).toBeDefined();
    const dates = [...MODULE_KEY_MIGRATIONS].map((name) => name.slice(0, 14));
    expect(
      dates.every(
        (date) =>
          date <= LAST_MODULE_KEY_MIGRATION ||
          date < PAGE_PERMISSIONS_MIGRATION!
      )
    ).toBe(true);
    expect(
      MODULE_KEY_MIGRATIONS.has(
        `${LAST_MODULE_KEY_MIGRATION}_module-keys-to-pages.sql`
      )
    ).toBe(true);
  });

  it("flags a managed function file whatever its age", () => {
    expect(
      scan(
        `PERFORM assert_audit_log_access(p_company_id, 'settings_view');\nAND p.qual LIKE '%settings_view%'`,
        "packages/database/src/event-system/functions/get_audit_log.sql"
      )
    ).toEqual(["settings_view", "settings_view"]);
  });

  it("passes page keys, portal keys and comments", () => {
    expect(
      scan(
        [
          `-- the old key was settings_view`,
          `SELECT get_companies_with_employee_permission('settings.auditLogs_view');`,
          `SELECT get_customer_ids_with_customer_permission('parts_view');`,
          `SELECT get_supplier_ids_with_supplier_permission('parts_update');`,
          `SELECT get_companies_with_employee_permission(''documents_view'');`
        ].join("\n"),
        after
      )
    ).toEqual([]);
  });
});
