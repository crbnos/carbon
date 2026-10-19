// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  LAST_MODULE_KEY_MIGRATION,
  noModulePermissionKey
} from "./no-module-permission-key";

const ROUTE = "apps/erp/app/routes/x+/inventory+/receipts.tsx";
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
          `holdsAny(expanded, "sales", "view", companyId);`,
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

  it("never scans the authz manifest", () => {
    expect(
      scan(
        `widget: company("inventory", { read: "inventory_view" }),`,
        "packages/database/src/authz/manifest.ts"
      )
    ).toEqual([]);
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

  it("leaves older migrations alone", () => {
    expect(
      scan(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        `${LAST_MODULE_KEY_MIGRATION}_module-keys-to-pages.sql`
      )
    ).toEqual([]);
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
