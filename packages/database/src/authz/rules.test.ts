// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, test } from "vitest";
import { manifest } from "./manifest";
import {
  type AnyRule,
  always,
  anyOf,
  anyPageOf,
  company,
  custom,
  exists,
  group,
  inCompany,
  type Manifest,
  parent,
  policies,
  projectModule,
  render,
  serviceOnly
} from "./rules";

const key = (permission: string) =>
  `get_companies_with_employee_permission('${permission}')`;
const policy = (sql: string, command: string) =>
  sql.split("\n").find((line) => line.includes(`FOR ${command}`)) ?? "";

// "kanban" is owned by one page, Kanbans.
describe("render", () => {
  test("company: the owning page's keys, and a read of its module", () => {
    expect(render(company(), "kanban")).toBe(
      [
        `CREATE POLICY "SELECT" ON "public"."kanban" FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_module_view(ARRAY['inventory']::text[], '{}'::text[]))::text[]));`,
        `CREATE POLICY "INSERT" ON "public"."kanban" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT ${key("inventory.kanbans_create")})::text[]));`,
        `CREATE POLICY "UPDATE" ON "public"."kanban" FOR UPDATE USING ("companyId" = ANY ((SELECT ${key("inventory.kanbans_update")})::text[]));`,
        `CREATE POLICY "DELETE" ON "public"."kanban" FOR DELETE USING ("companyId" = ANY ((SELECT ${key("inventory.kanbans_delete")})::text[]));`
      ].join("\n")
    );
  });

  test("company: an update row predicate keeps the new row in the company", () => {
    const sql = render(
      company<"journal">({
        where: { update: (eb) => eb("status", "=", "Draft") }
      }),
      "kanban"
    );
    expect(sql).toContain(
      `FOR UPDATE USING (("status" = 'Draft' AND "companyId" = ANY ((SELECT ${key("inventory.kanbans_update")})::text[]))) WITH CHECK ("companyId" = ANY ((SELECT ${key("inventory.kanbans_update")})::text[]));`
    );
  });

  test("company: an employee read and a page key render as written", () => {
    const sql = render(
      company({
        read: "employee",
        create: "purchasing.purchaseOrders_create"
      }),
      "kanban"
    );
    expect(policy(sql, "SELECT")).toContain(
      "get_companies_with_employee_role()"
    );
    expect(policy(sql, "INSERT")).toContain(
      key("purchasing.purchaseOrders_create")
    );
  });

  test("group: scoped by companyGroupId through the group helpers, with the owner's key", () => {
    const sql = render(group({ read: "employee" }), "dimension");
    expect(sql).toContain(
      `FOR SELECT USING ("companyGroupId" = ANY ((SELECT get_company_groups_for_employee())::text[]));`
    );
    expect(sql).toContain(
      `FOR DELETE USING ("companyGroupId" = ANY ((SELECT get_company_groups_for_root_permission('accounting.dimensions_delete'))::text[]));`
    );
  });

  test("parent: an action is the parent table's, through the FK", () => {
    const sql = render(
      parent("pickingListLine", "pickingListLineId"),
      "pickingListLineTrackedEntity"
    );
    expect(sql).toContain(
      `CREATE POLICY "INSERT" ON "public"."pickingListLineTrackedEntity" FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM "public"."pickingListLine" p WHERE "p"."id" = "pickingListLineTrackedEntity"."pickingListLineId" AND "p"."companyId" = ANY ((SELECT ${key("inventory.pickingLists_create")})::text[])));`
    );
  });

  test("exists resolves an action against its parent, and starts the parent's path at the parent row", () => {
    const insert = policy(
      render(
        policies({
          insert: exists("methodMaterial", "methodMaterialId", "create")
        }),
        "methodMaterialStep"
      ),
      "INSERT"
    );
    expect(insert).toContain(
      `EXISTS (SELECT 1 FROM "public"."methodMaterial" p WHERE "p"."id" = "methodMaterialStep"."methodMaterialId" AND EXISTS (SELECT 1 FROM "public"."makeMethod" WHERE "makeMethod"."id" = "p"."makeMethodId" AND "makeMethod"."companyId" = "p"."companyId" AND EXISTS (SELECT 1 FROM "public"."item"`
    );
    expect(insert).not.toContain(`"methodMaterialStep"."companyId"`);
  });

  test("projectModule: the project's company and the page that owns the table decide", () => {
    const rule = company({
      read: projectModule("projectId", "view", { standard: "employee" }),
      update: projectModule("projectId", "update")
    });
    const child = render(rule, "projectElement");
    expect(child).toContain(
      `FOR SELECT USING (EXISTS (SELECT 1 FROM "public"."project" p WHERE "p"."id" = "projectElement"."projectId" AND "p"."companyId" = "projectElement"."companyId" AND "p"."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));`
    );
    expect(child).toContain(`'projects.projects_update'`);
  });

  test("projectModule via the element reaches the element's project", () => {
    const sql = render(
      company({
        read: projectModule("projectElementId", "view", {
          via: "projectElement"
        })
      }),
      "projectElementLabel"
    );
    expect(sql).toContain(
      `JOIN "public"."project" p ON "p"."id" = "e"."projectId" AND "p"."companyId" = "e"."companyId" WHERE "e"."id" = "projectElementLabel"."projectElementId" AND "e"."companyId" = "projectElementLabel"."companyId"`
    );
    expect(sql).toContain(`get_companies_with_module_view(ARRAY['projects']`);
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
    const sql = render(parent("item", "itemId"), "itemCost", "scratch");
    expect(sql).toContain(`ON "scratch"."itemCost"`);
    expect(sql).toContain(`FROM "public"."item" p`);
    expect(sql).not.toContain(`"public"."itemCost"`);
  });

  test("identifiers are quoted", () => {
    expect(render(policies({ select: always }), 'we"ird')).toContain(
      `ON "public"."we""ird"`
    );
  });

  test("predicate values are inlined as literals, never bind parameters", () => {
    const sql = render(
      company<"journal">({
        where: {
          update: (eb) => eb("status", "in", ["Draft", "O'Brien"] as never)
        }
      }),
      "kanban"
    );
    expect(sql).toContain(`"status" in ('Draft', 'O''Brien')`);
    expect(sql).not.toMatch(/\$\d/);
  });

  test("an action on a table no page owns throws: there is no owner to name", () => {
    expect(() => render(company(), "widget")).toThrow(/no page owns widget/);
  });
});

describe("render: actions become page keys", () => {
  const moduleView = (modules: string[], keys: string[] = []) =>
    `get_companies_with_module_view(ARRAY[${modules.map((m) => `'${m}'`).join(", ")}]::text[], ${
      keys.length
        ? `ARRAY[${keys.map((k) => `'${k}'`).join(", ")}]::text[]`
        : "'{}'::text[]"
    })`;

  test("a read names the owner's module, never its pages, plus the readers", () => {
    expect(policy(render(company(), "purchaseOrder"), "SELECT")).toBe(
      `CREATE POLICY "SELECT" ON "public"."purchaseOrder" FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_module_view(ARRAY['purchasing']::text[], ARRAY['inventory.receipts_view', 'invoicing.purchaseInvoices_view']::text[]))::text[]));`
    );
    // Writes stay per page.
    expect(policy(render(company(), "purchaseOrder"), "UPDATE")).toBe(
      `CREATE POLICY "UPDATE" ON "public"."purchaseOrder" FOR UPDATE USING ("companyId" = ANY ((SELECT ${key("purchasing.purchaseOrders_update")})::text[]));`
    );
  });

  test("anyPageOf names modules; repeated keys render once", () => {
    expect(
      policy(
        render(
          policies({
            select: inCompany("companyId", anyPageOf("sales", "inventory"))
          }),
          "kanban"
        ),
        "SELECT"
      )
    ).toContain(moduleView(["sales", "inventory"]));
    const select = policy(
      render(
        company({
          read: anyOf("sales.customers_view", "sales.customers_view")
        }),
        "address"
      ),
      "SELECT"
    );
    expect(select.split("'sales.customers_view'").length).toBe(2);
  });

  test("alsoWrittenBy: a write admits the owner or the pages the registry lists", () => {
    const sql = render(company(), "shipmentLine");
    expect(policy(sql, "INSERT")).toContain(
      `get_companies_with_any_employee_permission(ARRAY['inventory.shipments_create', 'sales.salesOrders_create']::text[])`
    );
    expect(policy(sql, "SELECT")).not.toContain("sales.salesOrders_create");
  });

  test("a shared table checks the page whose rows it is: by value, or by a column that is set", () => {
    expect(policy(render(company(), "item"), "UPDATE")).toContain(
      `("item"."type" = 'Tool' AND "companyId" = ANY ((SELECT ${key("parts.tools_update")})::text[]))`
    );
    expect(policy(render(company(), "memo"), "UPDATE")).toBe(
      `CREATE POLICY "UPDATE" ON "public"."memo" FOR UPDATE USING ((("memo"."supplierId" IS NOT NULL AND "companyId" = ANY ((SELECT ${key("invoicing.supplierCredits_update")})::text[])) OR ("memo"."customerId" IS NOT NULL AND "companyId" = ANY ((SELECT ${key("invoicing.creditMemos_update")})::text[]))));`
    );
  });

  test("a child table checks its parent row's page, in the row's own company", () => {
    expect(policy(render(company(), "itemCost"), "INSERT")).toContain(
      `WITH CHECK (EXISTS (SELECT 1 FROM "public"."item" WHERE "item"."id" = "itemCost"."itemId" AND "item"."companyId" = "itemCost"."companyId" AND (("item"."type" = 'Part' AND "companyId" = ANY ((SELECT ${key("parts.parts_create")})::text[]))`
    );
  });

  test("a child two hops away checks its item's page through each hop, every hop in the company of the last", () => {
    expect(policy(render(company(), "methodMaterial"), "UPDATE")).toContain(
      `USING (EXISTS (SELECT 1 FROM "public"."makeMethod" WHERE "makeMethod"."id" = "methodMaterial"."makeMethodId" AND "makeMethod"."companyId" = "methodMaterial"."companyId" AND EXISTS (SELECT 1 FROM "public"."item" WHERE "item"."id" = "makeMethod"."itemId" AND "item"."companyId" = "makeMethod"."companyId" AND (("item"."type" = 'Part' AND "companyId" = ANY ((SELECT ${key("parts.parts_update")})::text[])) OR ("item"."type" = 'Material'`
    );
  });

  test("a child read names no parent table: its parent's module, plus readers", () => {
    const select = policy(render(company(), "supplierPart"), "SELECT");
    expect(select).not.toContain(`"public"."item"`);
    expect(select).toContain(`get_companies_with_module_view(ARRAY['parts']`);
  });

  test("no table's SELECT policy reaches back to itself", () => {
    // A policy subquery runs under the SELECT policies of the table it reads,
    // so a cycle of SELECT policies is what Postgres refuses as recursion.
    const reads = new Map<string, Set<string>>();
    for (const [table, rule] of Object.entries(manifest)) {
      const select = policy(render(rule as AnyRule, table), "SELECT");
      const named = [...select.matchAll(/"public"\."(\w+)"/g)]
        .map((m) => m[1] as string)
        .filter((name, i) => i > 0 || name !== table);
      reads.set(table, new Set(named));
    }
    const cycles: string[] = [];
    const walk = (table: string, trail: string[]) => {
      for (const next of reads.get(table) ?? []) {
        if (next === trail[0]) cycles.push([...trail, next].join(" → "));
        else if (!trail.includes(next)) walk(next, [...trail, next]);
      }
    };
    for (const table of reads.keys()) walk(table, [table]);
    expect(cycles).toEqual([]);
  });
});

// Type-level: these must not compile.
// @ts-expect-error a module key: name an action or a page key
company({ read: "parts_view" });
// @ts-expect-error not a permission
company({ read: "parts.parts_edit" });
// @ts-expect-error not a table
parent("itm", "itemId");
// Typed from the manifest key alone — no table named twice.
const typed: Manifest = {
  itemCost: parent("item", "itemId"),
  journal: company({
    where: { update: (eb) => eb("status", "in", ["Draft", "Posted"]) }
  })
};
const untyped: Manifest = {
  // @ts-expect-error not a column of itemCost
  itemCost: parent("item", "itmId"),
  journal: company({
    // @ts-expect-error not a column of journal
    where: { update: (eb) => eb("staus", "=", "Draft") }
  })
};
void typed;
void untyped;
company<"journal">({
  // @ts-expect-error not a journalEntryStatus value
  where: { update: (eb) => eb("status", "=", "Drafted") }
});
