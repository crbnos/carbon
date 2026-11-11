// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  PAGES,
  pagesOfUrl,
  routeUrl,
  urlCoverage,
  urlSegments
} from "@carbon/database/access";
import type { Violation } from "../check";

export const ROUTE_MAPS_TO_PAGE = "route-maps-to-page";

/** The ERP route tree whose files the check maps to pages. */
export const ERP_ROUTES_DIR = "apps/erp/app/routes/x+";

const THIS_FILE = "packages/checks/src/conformance/route-maps-to-page.ts";
const PAGES_DIR = "packages/database/src/access/pages";

/**
 * Routes under `x+` that belong to no one page, with the reason. A key that
 * ends with `/` covers its own URL and every route below it; any other key is
 * one route.
 */
export const UNPAGED_ROUTES: Readonly<Record<string, string>> = {
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
  "/x/timesheet/": "My Time: every employee's own timesheet.",
  "/x/accounting/projects": "Redirects to Projects.",
  "/x/settings/timekeeping": "Redirects to Time settings.",
  "/x/account/": "The signed-in person's own account.",
  "/x/acknowledge": "The ITAR acknowledgment every person signs.",
  "/x/print": "The print endpoint every page posts to.",
  "/x/shared/":
    "Notes, saved views and imports, which every page uses for its own records.",
  "/x/settings/tags/": "The tag endpoint every list page posts to.",
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
  "/x/revenue-recognition-run/":
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
  "/x/items/change-order/": "Redirects to a change notice.",
  "/x/items/change-order-types/": "Redirects to Change Notice Types.",
  "/x/items/change-order-actions/": "Redirects to Change Notice Actions.",
  "/x/change-order/": "Redirects to a new change notice."
};

/** The registry facts the check needs; `REGISTRY` is the real one. */
export type RouteRegistry = {
  pages: readonly { id: string; paths: readonly string[] }[];
};

export const REGISTRY: RouteRegistry = { pages: PAGES };

/** Whether an `UNPAGED_ROUTES` key lists the URL (plain text: no `$param`). */
const unpaged = (key: string, url: string) => {
  if (!key.endsWith("/")) return url === key;
  const path = key.slice(0, -1);
  return url === path || url.startsWith(key);
};

/**
 * Every ERP route under `x+` belongs to one page of the access registry, so a
 * gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed
 * in `UNPAGED_ROUTES` with the reason. `routes` are the route files relative
 * to `x+` (`inventory+/receipts.tsx`).
 *
 * It fails:
 * - a route no page covers and `UNPAGED_ROUTES` does not list, one that two
 *   pages cover equally (where `pageOfUrl` would pick by order), and one that
 *   is both on a page and listed;
 * - an `UNPAGED_ROUTES` entry that matches no route;
 * - a page path that matches no route.
 */
export function findRoutePageGaps(
  routes: readonly string[],
  registry: RouteRegistry = REGISTRY,
  unpagedRoutes: Readonly<Record<string, string>> = UNPAGED_ROUTES
): Violation[] {
  const violations: Violation[] = [];
  const push = (file: string, snippet: string, message: string) =>
    violations.push({ file, line: 0, snippet, message });
  const urls = routes.map((route) => ({ route, url: routeUrl(route) }));

  for (const { route, url } of urls) {
    const file = `${ERP_ROUTES_DIR}/${route}`;
    const pages = pagesOfUrl(url, registry.pages);
    const listed = Object.keys(unpagedRoutes).some((key) => unpaged(key, url));
    if (pages.length > 1)
      push(file, url, `${url} is on more than one page: ${pages.join(", ")}`);
    else if (pages.length === 1 && listed)
      push(
        file,
        url,
        `${url} is on ${pages[0]} and in UNPAGED_ROUTES; remove one`
      );
    else if (!pages.length && !listed)
      push(
        file,
        url,
        `${url} is on no page: add it to a page's \`paths\`, or to UNPAGED_ROUTES with the reason`
      );
  }

  for (const key of Object.keys(unpagedRoutes))
    if (!urls.some(({ url }) => unpaged(key, url)))
      push(THIS_FILE, key, `UNPAGED_ROUTES lists ${key}, which no route has`);

  for (const page of registry.pages)
    for (const path of page.paths)
      if (!urls.some(({ url }) => urlCoverage(path, urlSegments(url)) > 0))
        push(
          `${PAGES_DIR}/${page.id.split(".")[0]}.ts`,
          path,
          `${page.id}: no route has the path ${path}`
        );

  return violations;
}
