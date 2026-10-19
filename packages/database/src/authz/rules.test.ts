// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, test } from "vitest";
import {
  company,
  custom,
  group,
  type Manifest,
  parent,
  render,
  serviceOnly
} from "./rules";

describe("render", () => {
  test("company: the canonical four", () => {
    expect(render(company("parts"), "item")).toBe(
      [
        `CREATE POLICY "SELECT" ON "public"."item" FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));`,
        `CREATE POLICY "INSERT" ON "public"."item" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[]));`,
        `CREATE POLICY "UPDATE" ON "public"."item" FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[]));`,
        `CREATE POLICY "DELETE" ON "public"."item" FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[]));`
      ].join("\n")
    );
  });

  test("company: an update row predicate keeps the new row in the company", () => {
    const sql = render(
      company<"journal">("accounting", {
        where: { update: (eb) => eb("status", "=", "Draft") }
      }),
      "journal"
    );
    expect(sql).toContain(
      `FOR UPDATE USING (("status" = 'Draft' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]))) WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));`
    );
  });

  test("company: a read permission replaces the employee read", () => {
    expect(
      render(company("inventory", { read: "inventory_view" }), "pickingList")
    ).toContain(
      `FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[]));`
    );
  });

  test("group: scoped by companyGroupId through the group helpers", () => {
    const sql = render(group("accounting"), "dimension");
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
      "pickingListLineTrackedEntity"
    );
    expect(sql).toContain(
      `CREATE POLICY "INSERT" ON "public"."pickingListLineTrackedEntity" FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM "public"."pickingListLine" p WHERE "p"."id" = "pickingListLineTrackedEntity"."pickingListLineId" AND "p"."companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])));`
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
      "journal"
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
