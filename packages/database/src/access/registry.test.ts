// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { manifest } from "../authz/manifest";
import { type AnyRule, company, render } from "../authz/rules";
import { Constants } from "../constants";
import {
  childPath,
  isPageModule,
  MODULES,
  moduleEnum,
  moduleId,
  moduleOf,
  ownersOf,
  PAGES,
  type Page,
  pageOfRow,
  pageOfTable,
  pageOfUrl,
  pagesOf,
  readersOf,
  readPages,
  routeUrl,
  tableReadGate,
  urlCoverage,
  urlSegments,
  writersOf
} from "./registry";
import { holdsGate } from "./resolve";

/** The rendered policies of a table, one per line. */
const policiesOf = (table: string) =>
  render(manifest[table as keyof typeof manifest] as AnyRule, table).split(
    "\n"
  );

const keysIn = (list: string) =>
  [...list.matchAll(/'([\w.]+)_(?:view|create|update|delete)'/g)].map(
    (key) => key[1] as string
  );

/** Every `<key>_<action>` an employee permission check in SQL names. */
const checkedKeys = (sql: string) => [
  ...[
    ...sql.matchAll(
      /get_(?:companies_with_employee_permission|company_groups_for_root_permission)\('([\w.]+)_(?:view|create|update|delete)'/g
    )
  ].map((match) => match[1] as string),
  ...[
    ...sql.matchAll(
      /get_companies_with_(?:any_employee_permission\(|module_view\(ARRAY\[[^\]]*\]::text\[\], )ARRAY\[([^\]]*)\]/g
    )
  ].flatMap((match) => keysIn(match[1] as string))
];

/** The modules a read admits View on any page of (get_companies_with_module_view). */
const viewedModules = (sql: string) =>
  [
    ...sql.matchAll(/get_companies_with_module_view\(ARRAY\[([^\]]*)\]/g)
  ].flatMap((match) =>
    [...(match[1] as string).matchAll(/'(\w+)'/g)].map((m) => m[1] as string)
  );

/** Whether SQL checks a permission, not only "employee". */
const namesPermission = (sql: string) =>
  checkedKeys(sql).length > 0 || viewedModules(sql).length > 0;

const NAMED_TABLES = Object.keys(manifest).filter((table) =>
  policiesOf(table).some(namesPermission)
);

describe("PAGES", () => {
  it("gives every page a unique id", () => {
    const ids = PAGES.map((page) => page.id);
    expect(ids.length - new Set(ids).size).toBe(0);
  });

  it("lists the modules in sidebar order, each page file one module", () => {
    expect([...new Set(PAGES.map((page) => moduleOf(page.id)))]).toEqual(
      MODULES.map((module) => module.id)
    );
  });

  it("names only tables the manifest has a rule for", () => {
    const unknown = PAGES.flatMap((page) =>
      [
        ...page.tables,
        ...("children" in page
          ? page.children.flatMap((c) => [
              c.table,
              ...childPath(c, page.where.table).map(([, table]) => table)
            ])
          : []),
        ...("readers" in page ? page.readers : [])
      ]
        .filter((table) => !(table in manifest))
        .map((table) => `${page.id}: ${table}`)
    );
    expect(unknown).toEqual([]);
  });

  it("gives a shared table a `where` on every page that lists it", () => {
    const problems: string[] = [];
    for (const page of PAGES) {
      if (!("where" in page)) continue;
      if (!page.tables.includes(page.where.table as never))
        problems.push(
          `${page.id}: where names ${page.where.table}, not in its tables`
        );
      const sharers = PAGES.filter((p) =>
        (p.tables as readonly string[]).includes(page.where.table)
      );
      if (sharers.length < 2)
        problems.push(`${page.id}: ${page.where.table} is not shared`);
    }
    for (const table of new Set(PAGES.flatMap((page) => page.tables))) {
      const owners = PAGES.filter((page) =>
        (page.tables as readonly string[]).includes(table)
      );
      if (owners.length < 2) continue;
      for (const owner of owners) {
        if (!("where" in owner) || owner.where.table !== table)
          problems.push(`${owner.id}: shares ${table} without a where`);
      }
    }
    expect(problems).toEqual([]);
  });

  // A read already admits View on any page of the owning page's module, so a
  // reader in that module changes nothing; a table every employee reads needs
  // no reader at all.
  it("lists as readers only restricted tables of other modules", () => {
    const problems: string[] = [];
    for (const page of PAGES as readonly Page[]) {
      for (const table of page.readers ?? []) {
        const owners = ownersOf(table);
        const select = policiesOf(table).find((policy) =>
          policy.includes("FOR SELECT")
        );
        if (!owners.length) problems.push(`${page.id}: ${table} is on no page`);
        else if (owners.every((owner) => moduleOf(owner) === moduleOf(page.id)))
          problems.push(`${page.id}: ${table} is a table of its own module`);
        else if (!select || !namesPermission(select))
          problems.push(`${page.id}: every employee reads ${table}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("picks a shared table's rows by a string value, never a boolean spelled as a string", () => {
    const problems = (PAGES as readonly Page[]).flatMap((page) =>
      page.where?.value === "true" || page.where?.value === "false"
        ? [`${page.id}: ${page.where.table}.${page.where.column}`]
        : []
    );
    expect(problems).toEqual([]);
  });

  it("picks rows of an enum column by a value of its enum", () => {
    const enums: Record<string, readonly string[]> = {
      "item.type": Constants.public.Enums.itemType,
      "revenueRecognitionRun.type": Constants.public.Enums.runType,
      "enforcementRule.family": Constants.public.Enums.enforcementRuleFamily
    };
    const problems = (PAGES as readonly Page[]).flatMap((page) => {
      if (typeof page.where?.value !== "string") return [];
      const values = enums[`${page.where.table}.${page.where.column}`];
      if (!values)
        return [
          `${page.id}: ${page.where.table}.${page.where.column} is not listed here`
        ];
      return values.includes(page.where.value)
        ? []
        : [`${page.id}: ${page.where.value} is no value of the enum`];
    });
    expect(problems).toEqual([]);
  });

  it("names modules that have pages in every module read", () => {
    const modules = new Set(PAGES.map((page) => moduleOf(page.id)));
    const problems = Object.keys(manifest).flatMap((table) =>
      viewedModules(policiesOf(table).join("\n"))
        .filter((module) => !modules.has(module))
        .map((module) => `${table}: ${module}`)
    );
    expect(problems).toEqual([]);
  });

  it("checks a page key, never a module key, in every policy", () => {
    const pageIds = new Set<string>(PAGES.map((page) => page.id));
    const problems = Object.keys(manifest).flatMap((table) =>
      checkedKeys(policiesOf(table).join("\n"))
        .filter((key) => !pageIds.has(key))
        .map((key) => `${table}: ${key}`)
    );
    expect([...new Set(problems)]).toEqual([]);
  });

  it("puts each table that checks a permission on one page or one shared entry", () => {
    const problems: string[] = [];
    for (const table of NAMED_TABLES) {
      const owners = PAGES.filter((page) =>
        (page.tables as readonly string[]).includes(table)
      );
      const parents = PAGES.filter(
        (page) =>
          "children" in page && page.children.some((c) => c.table === table)
      );
      if (owners.length && parents.length)
        problems.push(`${table}: both owned and a child`);
      else if (!owners.length && !parents.length)
        problems.push(`${table}: on no page`);
      else if (parents.length) {
        const shared = new Set(
          parents.map((page) => ("where" in page ? page.where.table : null))
        );
        if (shared.size !== 1 || shared.has(null))
          problems.push(`${table}: a child of more than one shared table`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("ends each child's path at its shared table, through children of the same table", () => {
    const problems: string[] = [];
    for (const page of PAGES) {
      if (!("children" in page)) continue;
      const shared = page.where.table;
      const paths = new Map(
        page.children.map((c) => [c.table, childPath(c, shared)])
      );
      for (const [table, path] of paths) {
        if (path.at(-1)?.[1] !== shared)
          problems.push(`${page.id}: ${table} does not end at ${shared}`);
        // A hop through another table follows that table's own path, so the
        // two cannot disagree about how a row reaches the shared table.
        const [, next] = path[0] ?? [];
        if (next && next !== shared) {
          const rest = JSON.stringify(path.slice(1));
          if (JSON.stringify(paths.get(next)) !== rest)
            problems.push(
              `${page.id}: ${table} goes through ${next}, which is not a child with the same path`
            );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("modules", () => {
  it("maps each module id to its enum label and back", () => {
    expect(MODULES.find((module) => module.id === "parts")).toEqual({
      id: "parts",
      label: "Items",
      enum: "Parts"
    });
    for (const module of MODULES) {
      expect(moduleEnum(module.id)).toBe(module.enum);
      expect(moduleId(module.enum)).toBe(module.id);
    }
  });

  it("refuses a label with no pages, or not in enum case", () => {
    for (const label of ["Items", "Messaging", "Printing", "inventory", ""])
      expect(isPageModule(label)).toBe(false);
    expect(moduleId("Items")).toBeUndefined();
    expect(isPageModule("Parts")).toBe(true);
    expect(isPageModule("Documents")).toBe(true);
  });
});

describe("pageOfUrl", () => {
  it("takes the page whose longest path covers the URL", () => {
    expect(pageOfUrl("/x/inventory/receipts")).toBe("inventory.receipts");
    expect(pageOfUrl("/x/inventory/receipts/")).toBe("inventory.receipts");
    expect(pageOfUrl("/x/inventory/receipts?status=Draft")).toBe(
      "inventory.receipts"
    );
    expect(pageOfUrl("/x/purchase-invoice/pi1/details")).toBe(
      "invoicing.purchaseInvoices"
    );
  });

  it("matches a $param segment against any one segment", () => {
    expect(pageOfUrl("/x/customer/c1/assets")).toBe("service.customerAssets");
    expect(pageOfUrl("/x/customer/$customerId/assets")).toBe(
      "service.customerAssets"
    );
    expect(pageOfUrl("/x/customer/c1/bank-accounts")).toBe(
      pageOfUrl("/x/supplier/s1/bank-accounts")
    );
  });

  it("matches whole segments only", () => {
    expect(pageOfUrl("/x/inventory/receiptsX")).not.toBe("inventory.receipts");
  });

  it("is undefined for a URL no page covers", () => {
    expect(pageOfUrl("/x")).toBeUndefined();
    expect(pageOfUrl("/somewhere/else")).toBeUndefined();
  });
});

describe("pageOfRow", () => {
  it("names the owning page of an unshared table", () => {
    expect(pageOfRow("charge", {})).toBe("invoicing.charges");
  });

  it("picks a shared table's page by its where", () => {
    expect(pageOfRow("item", { type: "Tool" })).toBe("parts.tools");
    expect(pageOfRow("memo", { supplierId: "s1", customerId: null })).toBe(
      "invoicing.supplierCredits"
    );
    expect(pageOfRow("memo", { supplierId: null, customerId: "c1" })).toBe(
      "invoicing.creditMemos"
    );
    expect(pageOfRow("revenueRecognitionRun", { type: "Lease" })).toBe(
      "accounting.leases"
    );
    expect(
      pageOfRow("revenueRecognitionRun", { type: "Revenue Recognition" })
    ).toBe("accounting.revenueRecognition");
    expect(pageOfRow("contact", { isCustomer: true })).toBe(
      pageOfRow("contact", { isCustomer: "true" })
    );
    expect(pageOfRow("contact", { isCustomer: false })).not.toBe(
      pageOfRow("contact", { isCustomer: true })
    );
  });

  it("is undefined when no where matches, or for an unknown or child table", () => {
    expect(pageOfRow("item", { type: "Fixture" })).toBeUndefined();
    expect(pageOfRow("memo", {})).toBeUndefined();
    expect(pageOfRow("nowhere", {})).toBeUndefined();
    expect(pageOfRow("purchaseReturnOrderCreditLine", {})).toBeUndefined();
  });
});

describe("pageOfTable", () => {
  it("is pageOfRow for a table some page owns", () => {
    expect(pageOfTable("charge")).toBe("invoicing.charges");
    expect(pageOfTable("revenueRecognitionRun", { type: "Lease" })).toBe(
      "accounting.leases"
    );
  });

  it("throws when no page owns the row", () => {
    expect(() => pageOfTable("nowhere")).toThrow("No page owns nowhere");
    expect(() => pageOfTable("memo")).toThrow("No page owns memo");
  });
});

describe("ownersOf", () => {
  it("is the owning page, every branch's page of a shared table, or none", () => {
    expect(ownersOf("charge")).toEqual(["invoicing.charges"]);
    expect(ownersOf("memo")).toEqual(
      expect.arrayContaining([
        "invoicing.creditMemos",
        "invoicing.supplierCredits"
      ])
    );
    expect(ownersOf("nowhere")).toEqual([]);
  });
});

describe("writersOf", () => {
  it("is the pages that list the table in alsoWrittenBy", () => {
    expect(writersOf("shipmentLine")).toEqual(["sales.salesOrders"]);
    expect(writersOf("charge")).toEqual([]);
  });

  it("lists only tables the page owns, and other pages", () => {
    for (const page of PAGES as readonly Page[])
      for (const [table, writers] of Object.entries(page.alsoWrittenBy ?? {})) {
        expect(ownersOf(table)).toContain(page.id);
        for (const writer of writers) expect(writer).not.toBe(page.id);
      }
  });
});

describe("tableReadGate", () => {
  const viewOf = (...pages: string[]) =>
    Object.fromEntries(
      pages.map((page) => [
        page,
        { view: ["c1"], create: [], update: [], delete: [] }
      ])
    );
  const reads = (table: string, ...pages: string[]) =>
    holdsGate(viewOf(...pages), tableReadGate(table), "c1");

  it("refuses a table of another module to a page that reads only one of its siblings", () => {
    // Suppliers lists `address` in readers, which Customers also owns.
    expect(ownersOf("address")).toEqual(["sales.customers"]);
    expect(reads("customer", "purchasing.suppliers")).toBe(false);
  });

  it("admits View on any page of the owner's module", () => {
    expect(reads("customer", "sales.quotes")).toBe(true);
  });

  it("admits a page that lists the table in readers", () => {
    expect(reads("address", "purchasing.suppliers")).toBe(true);
  });

  it("admits nobody on a table no page owns", () => {
    expect(tableReadGate("nowhere")).toEqual({ anyOf: [] });
  });

  it("equals what each company() rule's SELECT policy admits", () => {
    const select = (sql: string) =>
      sql.split("\n").find((line) => line.includes("FOR SELECT")) ?? "";
    const checked = Object.keys(manifest).filter(
      (table) =>
        ownersOf(table).length > 0 &&
        select(policiesOf(table).join("\n")) ===
          select(render(company(), table))
    );
    const problems = checked.flatMap((table) => {
      const sql = select(policiesOf(table).join("\n"));
      const rendered = new Set([
        ...viewedModules(sql).flatMap(pagesOf),
        ...checkedKeys(sql)
      ]);
      const gate = new Set(
        tableReadGate(table).anyOf.flatMap((entry) => Object.keys(entry))
      );
      const same =
        rendered.size === gate.size &&
        [...gate].every((page) => rendered.has(page));
      return same ? [] : [`${table}: ${[...gate]} vs ${[...rendered]}`];
    });
    expect(problems).toEqual([]);
    // The comparison covers the tables that list readers, not only the plain ones.
    expect(
      checked.filter((table) => readersOf(table).length).length
    ).toBeGreaterThan(5);
  });
});

// A grant on a page of the new module would read every table of that module,
// so a moved table keeps a page of its old module instead.
describe("tables that moved module", () => {
  const viewOf = (...pages: string[]) =>
    Object.fromEntries(
      pages.map((page) => [
        page,
        { view: ["c1"], create: [], update: [], delete: [] }
      ])
    );
  const reads = (table: string, page: string) =>
    holdsGate(viewOf(page), tableReadGate(table), "c1");

  it.each([
    ["itemPostingGroup", "accounting.defaultAccounts"],
    ["accountingCutoverIgnoredInvoice", "accounting.reporting"],
    ["demandProjection", "inventory.quantities"],
    ["demandForecast", "inventory.quantities"],
    ["demandForecastSource", "inventory.quantities"],
    ["supplyForecast", "inventory.quantities"],
    ["demandActual", "inventory.quantities"],
    ["supplyActual", "inventory.quantities"],
    ["storageType", "parts.parts"],
    ["storageUnit", "parts.parts"],
    ["trainingAssignment", "people.employees"],
    ["trainingCompletion", "people.employees"],
    ["trainingQuestion", "people.employees"],
    ["userAttributeCategory", "resources.abilities"],
    ["fiscalYearSettings", "settings.company"]
  ])("lets the old module's page write %s (%s)", (table, page) => {
    expect(writersOf(table)).toEqual([page]);
  });

  it.each([
    ["itemPostingGroup", "accounting.defaultAccounts"],
    ["accountingCutoverIgnoredInvoice", "accounting.reporting"],
    ["demandProjection", "inventory.quantities"],
    ["demandForecast", "inventory.quantities"],
    ["trainingAssignment", "people.employees"],
    ["userAttribute", "resources.abilities"],
    ["fiscalYearSettings", "settings.company"]
  ])("lets the old module's page read %s (%s)", (table, page) => {
    expect(reads(table, page)).toBe(true);
  });

  it("renders the old page into the reads that go through userAttribute's category", () => {
    const select = policiesOf("userAttribute").find((line) =>
      line.includes("FOR SELECT")
    );
    expect(checkedKeys(select ?? "")).toContain("resources.abilities");
  });

  it("does not let the old module's page read the rest of the new module", () => {
    expect(reads("payrollPeriodTotal", "resources.abilities")).toBe(false);
    expect(reads("timeCardEntry", "resources.abilities")).toBe(false);
    expect(reads("planningAction", "inventory.quantities")).toBe(false);
    expect(reads("supplierBankAccount", "settings.company")).toBe(false);
    expect(reads("journal", "settings.company")).toBe(false);
  });
});

describe("privateReads", () => {
  const viewOf = (...pages: string[]) =>
    Object.fromEntries(
      pages.map((page) => [
        page,
        { view: ["c1"], create: [], update: [], delete: [] }
      ])
    );
  const reads = (table: string, page: string) =>
    holdsGate(viewOf(page), tableReadGate(table), "c1");

  it.each([
    ["apiKey", "settings.apiKeys"],
    ["apiKeyRateLimit", "settings.apiKeys"],
    ["webhook", "settings.webhooks"],
    ["integrationConnection", "settings.integrations"]
  ])("reads %s on its own page only", (table, page) => {
    expect(tableReadGate(table)).toEqual({ anyOf: [{ [page]: "View" }] });
    expect(reads(table, "settings.printing")).toBe(false);
  });

  it("renders the own page's key, not a module read, in the SELECT policy", () => {
    for (const [table, page] of [
      ["apiKey", "settings.apiKeys"],
      ["apiKeyRateLimit", "settings.apiKeys"],
      ["webhook", "settings.webhooks"],
      ["integrationConnection", "settings.integrations"]
    ] as const) {
      const select =
        policiesOf(table).find((line) => line.includes("FOR SELECT")) ?? "";
      expect(viewedModules(select)).toEqual([]);
      expect(checkedKeys(select)).toEqual([page]);
    }
  });

  it("keeps companyIntegration a read of any Settings page", () => {
    expect(reads("companyIntegration", "settings.printing")).toBe(true);
  });

  it("does not widen a View gate on a page with private tables to its module", () => {
    expect(readPages("settings.apiKeys")).toEqual(["settings.apiKeys"]);
    expect(readPages("settings.webhooks")).toEqual(["settings.webhooks"]);
    expect(readPages("settings.printing")).toContain("settings.company");
  });
});

describe("routeUrl", () => {
  it("drops layout and index segments and splits on dots", () => {
    expect(routeUrl("part+/$itemId.sales.rental-rates.new.tsx")).toBe(
      "/x/part/$itemId/sales/rental-rates/new"
    );
    expect(routeUrl("inventory+/_index.tsx")).toBe("/x/inventory");
  });
});

describe("urlCoverage", () => {
  it("counts the path's segments when it covers the URL", () => {
    const url = urlSegments("/x/customer/c1/assets?tab=1");
    expect(url).toEqual(["x", "customer", "c1", "assets"]);
    expect(urlCoverage("/x/customer", url)).toBe(2);
    expect(urlCoverage("/x/customer/$customerId/assets", url)).toBe(4);
    expect(urlCoverage("/x/supplier", url)).toBe(0);
    expect(urlCoverage("/x/customer/c1/assets/more", url)).toBe(0);
  });
});
