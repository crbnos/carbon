// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, test } from "vitest";
import {
  anyOf,
  company,
  custom,
  group,
  type Manifest,
  parent,
  render,
  serviceOnly
} from "./rules";

// "widget" is on no page, so its module keys render as written: these tests are
// about the pieces. The page tests below use tables the registry places.
describe("render", () => {
  test("company: the canonical four", () => {
    expect(render(company("parts"), "widget")).toBe(
      [
        `CREATE POLICY "SELECT" ON "public"."widget" FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));`,
        `CREATE POLICY "INSERT" ON "public"."widget" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[]));`,
        `CREATE POLICY "UPDATE" ON "public"."widget" FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[]));`,
        `CREATE POLICY "DELETE" ON "public"."widget" FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[]));`
      ].join("\n")
    );
  });

  test("company: an update row predicate keeps the new row in the company", () => {
    const sql = render(
      company<"journal">("accounting", {
        where: { update: (eb) => eb("status", "=", "Draft") }
      }),
      "widget"
    );
    expect(sql).toContain(
      `FOR UPDATE USING (("status" = 'Draft' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]))) WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));`
    );
  });

  test("company: a read permission replaces the employee read", () => {
    expect(
      render(company("inventory", { read: "inventory_view" }), "widget")
    ).toContain(
      `FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[]));`
    );
  });

  test("group: scoped by companyGroupId through the group helpers", () => {
    const sql = render(group("accounting"), "widget");
    expect(sql).toContain(
      `FOR SELECT USING ("companyGroupId" = ANY ((SELECT get_company_groups_for_employee())::text[]));`
    );
    expect(sql).toContain(
      `FOR DELETE USING ("companyGroupId" = ANY ((SELECT get_company_groups_for_root_permission('accounting_delete'))::text[]));`
    );
  });

  test("parent: reached through the FK, writes gated on the write permission", () => {
    const sql = render(
      parent("pickingListLine", "pickingListLineId", "inventory", {
        read: "inventory_view"
      }),
      "widgetLine"
    );
    expect(sql).toContain(
      `CREATE POLICY "INSERT" ON "public"."widgetLine" FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM "public"."pickingListLine" p WHERE "p"."id" = "widgetLine"."pickingListLineId" AND "p"."companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])));`
    );
    expect(sql).toContain(
      `get_companies_with_employee_permission('inventory_view')`
    );
  });

  test("serviceOnly renders no policies", () => {
    expect(render(serviceOnly(), "apiKey")).toBe("");
  });

  test("custom renders against the target it is given", () => {
    const rule = custom(
      "reads its own rows only",
      (t) =>
        `CREATE POLICY "SELECT" ON ${t} FOR SELECT USING ("userId" = (SELECT auth.uid())::text);`
    );
    expect(render(rule, "userToCompany", "scratch")).toBe(
      `CREATE POLICY "SELECT" ON "scratch"."userToCompany" FOR SELECT USING ("userId" = (SELECT auth.uid())::text);`
    );
  });

  test("the schema parameter only moves the target, never the parent", () => {
    const sql = render(
      parent("item", "itemId", "parts"),
      "itemCost",
      "scratch"
    );
    expect(sql).toContain(`ON "scratch"."itemCost"`);
    expect(sql).toContain(`FROM "public"."item" p`);
    expect(sql).not.toContain(`"public"."itemCost"`);
  });

  test("identifiers are quoted", () => {
    expect(render(company("parts"), 'we"ird')).toContain(
      `ON "public"."we""ird"`
    );
  });

  test("predicate values are inlined as literals, never bind parameters", () => {
    const sql = render(
      company<"journal">("accounting", {
        where: {
          update: (eb) => eb("status", "in", ["Draft", "O'Brien"] as never)
        }
      }),
      "widget"
    );
    expect(sql).toContain(`"status" in ('Draft', 'O''Brien')`);
    expect(sql).not.toMatch(/\$\d/);
  });

  test("deterministic", () => {
    const rule = company<"journal">("accounting", {
      read: "accounting_view",
      where: {
        update: (eb) => eb("status", "in", ["Draft", "Posted"]),
        delete: (eb) => eb("status", "=", "Draft")
      }
    });
    expect(render(rule, "journal")).toBe(render(rule, "journal"));
  });
});

const key = (permission: string) =>
  `get_companies_with_employee_permission('${permission}')`;
const policy = (sql: string, command: string) =>
  sql.split("\n").find((line) => line.includes(`FOR ${command}`)) ?? "";

describe("render: module keys become page keys", () => {
  test("the page that owns the table decides, whatever module the rule names", () => {
    const sql = render(company("parts"), "storageUnit");
    expect(policy(sql, "INSERT")).toContain(
      key("inventory.storageUnits_create")
    );
    expect(sql).not.toContain("parts_");
    expect(policy(sql, "SELECT")).toContain(
      "get_companies_with_employee_role()"
    );
  });

  test("a restricted read also admits every page that lists the table in readers", () => {
    const select = policy(
      render(
        company("purchasing", { read: "purchasing_view" }),
        "purchaseOrder"
      ),
      "SELECT"
    );
    expect(select).toBe(
      `CREATE POLICY "SELECT" ON "public"."purchaseOrder" FOR SELECT USING (("companyId" = ANY ((SELECT ${key("purchasing.purchaseOrders_view")})::text[]) OR "companyId" = ANY ((SELECT ${key("inventory.receipts_view")})::text[]) OR "companyId" = ANY ((SELECT ${key("invoicing.purchaseInvoices_view")})::text[])));`
    );
  });

  test("module keys of two modules that resolve to one page render once", () => {
    const select = policy(
      render(
        company("sales", { read: anyOf("sales_view", "purchasing_view") }),
        "address"
      ),
      "SELECT"
    );
    expect(select.split(key("sales.customers_view")).length).toBe(2);
  });

  test("a shared table checks the page whose rows it is: by value, or by a column that is set", () => {
    expect(policy(render(company("parts"), "item"), "UPDATE")).toContain(
      `("item"."type" = 'Tool' AND "companyId" = ANY ((SELECT ${key("parts.tools_update")})::text[]))`
    );
    expect(policy(render(company("invoicing"), "memo"), "UPDATE")).toBe(
      `CREATE POLICY "UPDATE" ON "public"."memo" FOR UPDATE USING ((("memo"."supplierId" IS NOT NULL AND "companyId" = ANY ((SELECT ${key("invoicing.supplierCredits_update")})::text[])) OR ("memo"."customerId" IS NOT NULL AND "companyId" = ANY ((SELECT ${key("invoicing.creditMemos_update")})::text[]))));`
    );
  });

  test("a child table checks its parent row's page, in the row's own company", () => {
    expect(policy(render(company("parts"), "itemCost"), "INSERT")).toContain(
      `WITH CHECK (EXISTS (SELECT 1 FROM "public"."item" WHERE "item"."id" = "itemCost"."itemId" AND "item"."companyId" = "itemCost"."companyId" AND (("item"."type" = 'Part' AND "companyId" = ANY ((SELECT ${key("parts.parts_create")})::text[]))`
    );
  });

  test("a page key renders as written", () => {
    expect(
      policy(
        render(
          company("sales", { create: "purchasing.suppliers_create" }),
          "address"
        ),
        "INSERT"
      )
    ).toBe(
      `CREATE POLICY "INSERT" ON "public"."address" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT ${key("purchasing.suppliers_create")})::text[]));`
    );
  });

  test("a group table takes its owner's key", () => {
    expect(
      policy(render(group("accounting"), "dimension"), "DELETE")
    ).toContain(
      `get_company_groups_for_root_permission('accounting.dimensions_delete')`
    );
  });
});

// Type-level: these must not compile.
// @ts-expect-error not a module
company("partz");
// @ts-expect-error not a permission
company("parts", { read: "parts_edit" });
// @ts-expect-error not a table
parent("itm", "itemId", "parts");
// Typed from the manifest key alone — no table named twice.
const typed: Manifest = {
  itemCost: parent("item", "itemId", "parts"),
  journal: company("accounting", {
    where: { update: (eb) => eb("status", "in", ["Draft", "Posted"]) }
  })
};
const untyped: Manifest = {
  // @ts-expect-error not a column of itemCost
  itemCost: parent("item", "itmId", "parts"),
  journal: company("accounting", {
    // @ts-expect-error not a column of journal
    where: { update: (eb) => eb("staus", "=", "Draft") }
  })
};
void typed;
void untyped;
company<"journal">("accounting", {
  // @ts-expect-error not a column of journal
  where: { update: (eb) => eb("staus", "=", "Draft") }
});
company<"journal">("accounting", {
  // @ts-expect-error not a journalEntryStatus value
  where: { update: (eb) => eb("status", "=", "Drafted") }
});
