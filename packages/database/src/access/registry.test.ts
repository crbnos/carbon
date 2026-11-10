// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { manifest } from "../authz/manifest";
import { type AnyRule, render } from "../authz/rules";
import { Constants } from "../constants";
import {
  childPath,
  isPageModule,
  MODULES,
  moduleEnum,
  moduleId,
  moduleOf,
  PAGES,
  type Page,
  pageOfRow,
  pageOfUrl,
  placeOf
} from "./registry";

/**
 * Routes under `x+` that belong to no one page, with the reason. A key that
 * ends with `/` covers every route below it; any other key is one route.
 */
export const UNPAGED_ROUTES: Record<string, string> = {
  "/x": "The app shell and the home page.",
  // Documents, Workflows, Projects and Service have a page at their root.
  ...Object.fromEntries(
    [
      "accounting",
      "inventory",
      "invoicing",
      "items",
      "people",
      "production",
      "purchasing",
      "quality",
      "resources",
      "sales",
      "settings",
      "users"
    ].map((module) => [
      `/x/${module}`,
      "The module's layout; its index redirects to the module's first page."
    ])
  ),
  "/x/timesheet": "My Time: every employee's own timesheet.",
  "/x/timesheet/": "My Time: every employee's own timesheet.",
  "/x/accounting/projects": "Redirects to Projects.",
  "/x/settings/timekeeping": "Redirects to Time settings.",
  "/x/account/": "The signed-in person's own account.",
  "/x/account": "The signed-in person's own account.",
  "/x/acknowledge": "The ITAR acknowledgment every person signs.",
  "/x/print": "The print endpoint every page posts to.",
  "/x/shared/":
    "Notes, saved views and imports, which every page uses for its own records.",
  "/x/settings/tags/": "The tag endpoint every list page posts to.",
  "/x/settings/tags": "The tag endpoint every list page posts to.",
  "/x/get-started": "The Implementation Hub has no sidebar entry.",
  "/x/get-started/": "The Implementation Hub has no sidebar entry.",
  "/x/items/$itemId/properties":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/cost/$itemId":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/delete/$itemId":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/update":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/methods/":
    "Shared by the item pages that have a method; the item's type picks the page.",
  "/x/items/revisions/":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/rules/":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/inventory/batch-property/":
    "Batch properties of one item; the item's type picks the page.",
  "/x/credits/":
    "A memo's detail, shared by Supplier Credits and Credit Memos; the memo's party picks the page.",
  "/x/credits":
    "A memo's detail, shared by Supplier Credits and Credit Memos; the memo's party picks the page.",
  "/x/revenue-recognition-run/":
    "A run's detail, shared by Leases and Revenue Recognition; the run's type picks the page.",
  "/x/revenue-recognition-run":
    "A run's detail, shared by Leases and Revenue Recognition; the run's type picks the page.",
  "/x/priority": "The layout of Priorities and Resource Planning.",
  "/x/scheduling": "The layout of Forecast and Outbound.",
  "/x/invoicing/vendor-credits": "Redirects to Supplier Credits.",
  "/x/purchasing/invoices": "Redirects to Purchase Invoices.",
  "/x/sales/invoices": "Redirects to Sales Invoices.",
  "/x/production/inspection": "Redirects to Inspection Plans.",
  "/x/production/inspection/new": "Redirects to Inspection Plans.",
  "/x/quality/inbound-inspections": "Redirects to Inspections.",
  "/x/quality/inbound-inspections/$id": "Redirects to an inspection.",
  "/x/people/people": "Redirects to Employees.",
  "/x/items/change-orders/": "Redirects to Change Notices.",
  "/x/items/change-orders": "Redirects to Change Notices.",
  "/x/items/change-order/": "Redirects to a change notice.",
  "/x/items/change-order-types/": "Redirects to Change Notice Types.",
  "/x/items/change-order-actions/": "Redirects to Change Notice Actions.",
  "/x/change-order/": "Redirects to a new change notice."
};

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

/** The URL a flat-routes file serves: `receipt+/$receiptId.details.tsx` → `/x/receipt/$receiptId/details`. */
function routeUrl(file: string): string {
  const segments = file
    .replace(/\.(tsx?|jsx?)$/, "")
    .split("/")
    .flatMap((part) => part.replace(/\+$/, "").split("."))
    .filter((segment) => !segment.startsWith("_"))
    .map((segment) => segment.replace(/_$/, ""));
  return ["/x", ...segments].join("/");
}

const ROUTES_DIR = fileURLToPath(
  new URL("../../../../apps/erp/app/routes/x+/", import.meta.url)
);

// The files remix-flat-routes ignores (`apps/erp/app/routes.ts`).
const ROUTE_FILES = (readdirSync(ROUTES_DIR, { recursive: true }) as string[])
  .map((file) => file.split("\\").join("/"))
  .filter(
    (file) =>
      /\.(tsx?|jsx?)$/.test(file) &&
      !file.split("/").some((part) => part.startsWith(".")) &&
      !/(^|\/)__|\.(server|client|test)\./.test(file)
  );

/** A page path covers its own URL and every URL below it. */
const covers = (prefix: string, url: string) => {
  const path = prefix.replace(/\/$/, "");
  return url === path || url.startsWith(`${path}/`);
};

/** An unpaged key ending in `/` covers what is below it; any other key, one URL. */
const unpaged = (key: string, url: string) =>
  key.endsWith("/") ? covers(key, url) : url === key;

/** The pages whose longest path covers the URL. */
function pagesFor(url: string) {
  let best = 0;
  let found: string[] = [];
  for (const page of PAGES) {
    for (const path of page.paths) {
      const length = path.replace(/\/$/, "").length;
      if (!covers(path, url) || length < best) continue;
      if (length > best) found = [];
      best = length;
      if (!found.includes(page.id)) found.push(page.id);
    }
  }
  return found;
}

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
        const place = placeOf(table);
        const owners = !place
          ? []
          : place.kind === "page"
            ? [place.page]
            : place.branches.map((branch) => branch.page);
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

describe("paths", () => {
  const urls = ROUTE_FILES.map((file) => ({ file, url: routeUrl(file) }));

  it("maps every x+ route to one page, or lists it in UNPAGED_ROUTES", () => {
    const problems: string[] = [];
    for (const { file, url } of urls) {
      const pages = pagesFor(url);
      const reason = Object.keys(UNPAGED_ROUTES).some((key) =>
        unpaged(key, url)
      );
      if (pages.length > 1)
        problems.push(`${file} (${url}): ${pages.join(", ")}`);
      else if (pages.length === 1 && reason)
        problems.push(`${file} (${url}): ${pages[0]} and UNPAGED_ROUTES`);
      else if (!pages.length && !reason)
        problems.push(`${file} (${url}): no page`);
    }
    expect(problems).toEqual([]);
  });

  it("keeps no UNPAGED_ROUTES entry that matches no route", () => {
    const stale = Object.keys(UNPAGED_ROUTES).filter(
      (key) => !urls.some(({ url }) => unpaged(key, url))
    );
    expect(stale).toEqual([]);
  });

  it("puts each route on the page pageOfUrl names", () => {
    const problems = urls.flatMap(({ file, url }) => {
      const pages = pagesFor(url);
      const page = pageOfUrl(url);
      return pages.length === 1 && page !== pages[0]
        ? [`${file} (${url}): ${pages[0]}, pageOfUrl ${page}`]
        : [];
    });
    expect(problems).toEqual([]);
  });

  it("gives every page path at least one route", () => {
    const empty = PAGES.flatMap((page) =>
      page.paths
        .filter((path) => !urls.some(({ url }) => covers(path, url)))
        .map((path) => `${page.id}: ${path}`)
    );
    expect(empty).toEqual([]);
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
