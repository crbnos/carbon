// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { manifest } from "../authz/manifest";
import { type AnyRule, render } from "../authz/rules";
import { childPath, MODULES, moduleOf, PAGES } from "./registry";

/** The spec's page table (`.ai/specs/2026-10-18-page-level-permissions.md`, "The pages"). */
const SPEC_PAGE_COUNTS: Record<string, number> = {
  accounting: 20,
  documents: 1,
  inventory: 15,
  invoicing: 9,
  parts: 16,
  people: 6,
  production: 12,
  purchasing: 8,
  quality: 12,
  resources: 10,
  sales: 15,
  settings: 29,
  users: 4,
  workflows: 2
};

/**
 * Routes under `x+` that belong to no one page, with the reason. A key that
 * ends with `/` covers every route below it; any other key is one route.
 */
export const UNPAGED_ROUTES: Record<string, string> = {
  "/x": "The app shell and the home page.",
  // Documents and Workflows have a page at their root.
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

/** Every `<key>_<action>` an employee permission check in SQL names. */
const checkedKeys = (sql: string) =>
  [
    ...sql.matchAll(
      /get_(?:companies_with_employee_permission|company_groups_for_root_permission)\('([\w.]+)_(?:view|create|update|delete)'/g
    )
  ].map((match) => match[1] as string);

/** Whether SQL checks a permission, not only "employee". */
const namesPermission = (sql: string) => checkedKeys(sql).length > 0;

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

  it("has the spec's pages in each module, 159 in all", () => {
    const counts: Record<string, number> = {};
    for (const page of PAGES) {
      const module = moduleOf(page.id);
      counts[module] = (counts[module] ?? 0) + 1;
    }
    expect(counts).toEqual(SPEC_PAGE_COUNTS);
    expect(PAGES.length).toBe(159);
  });

  it("lists the modules in sidebar order, each with its pages", () => {
    expect(MODULES.map((module) => module.id)).toEqual(
      Object.keys(SPEC_PAGE_COUNTS)
    );
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

  it("lists as readers only restricted tables of other pages", () => {
    const problems: string[] = [];
    for (const page of PAGES) {
      if (!("readers" in page)) continue;
      for (const table of page.readers) {
        const own =
          (page.tables as readonly string[]).includes(table) ||
          ("children" in page && page.children.some((c) => c.table === table));
        const select = policiesOf(table).find((policy) =>
          policy.includes("FOR SELECT")
        );
        if (own) problems.push(`${page.id}: ${table} is its own table`);
        else if (!select || !namesPermission(select))
          problems.push(`${page.id}: every employee reads ${table}`);
      }
    }
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

  it("gives every page path at least one route", () => {
    const empty = PAGES.flatMap((page) =>
      page.paths
        .filter((path) => !urls.some(({ url }) => covers(path, url)))
        .map((path) => `${page.id}: ${path}`)
    );
    expect(empty).toEqual([]);
  });
});
