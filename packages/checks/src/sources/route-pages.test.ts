// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findRoutePageGaps, type RouteRegistry } from "./route-pages";

const routeRegistry = (
  overrides: Partial<RouteRegistry> = {}
): RouteRegistry => ({
  pages: [
    { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
    { id: "inventory.shipments", paths: ["/x/inventory/shipments"] }
  ],
  ...overrides
});

const UNPAGED_FILE =
  "packages/checks/src/conformance/authz/route-maps-to-page.ts";

const UNPAGED = {
  "/x": "The app shell.",
  "/x/account/": "The signed-in person's own account."
};

const ROUTES = [
  "_index.tsx",
  "inventory+/receipts.tsx",
  "inventory+/receipts.$id.tsx",
  "inventory+/shipments.tsx",
  "account+/profile.tsx"
];

const routeGaps = (
  routes: readonly string[],
  overrides: Partial<RouteRegistry> = {},
  unpaged: Record<string, string> = UNPAGED
) =>
  findRoutePageGaps(routes, routeRegistry(overrides), {
    file: UNPAGED_FILE,
    routes: unpaged
  }).map(({ file, snippet }) => [file, snippet]);

describe("findRoutePageGaps", () => {
  it("passes routes each on one page, and routes UNPAGED_ROUTES lists", () => {
    expect(routeGaps(ROUTES)).toEqual([]);
  });

  it("flags a route on no page that UNPAGED_ROUTES does not list", () => {
    expect(routeGaps([...ROUTES, "inventory+/kanbans.tsx"])).toEqual([
      ["apps/erp/app/routes/x+/inventory+/kanbans.tsx", "/x/inventory/kanbans"]
    ]);
  });

  it("flags a route two pages cover equally", () => {
    expect(
      routeGaps(ROUTES, {
        pages: [
          { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
          { id: "inventory.shipments", paths: ["/x/inventory/shipments"] },
          { id: "purchasing.receipts", paths: ["/x/inventory/receipts/"] }
        ]
      })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/receipts.tsx",
        "/x/inventory/receipts"
      ],
      [
        "apps/erp/app/routes/x+/inventory+/receipts.$id.tsx",
        "/x/inventory/receipts/$id"
      ]
    ]);
  });

  it("flags a route that is on a page and in UNPAGED_ROUTES", () => {
    expect(
      routeGaps(ROUTES, {}, { ...UNPAGED, "/x/inventory/shipments": "Listed." })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/shipments.tsx",
        "/x/inventory/shipments"
      ]
    ]);
  });

  it("matches a page path's $param to any one segment, as pageOfUrl does", () => {
    const customers = {
      pages: [
        { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
        { id: "inventory.shipments", paths: ["/x/inventory/shipments"] },
        { id: "sales.customers", paths: ["/x/customer/$customerId"] }
      ]
    };
    expect(
      routeGaps([...ROUTES, "customer+/$id.details.tsx"], customers)
    ).toEqual([]);
  });

  it("flags an UNPAGED_ROUTES entry that matches no route, in the file that lists it", () => {
    expect(routeGaps(ROUTES, {}, { ...UNPAGED, "/x/print": "Gone." })).toEqual([
      [UNPAGED_FILE, "/x/print"]
    ]);
  });

  it("flags a page path no route has", () => {
    expect(
      routeGaps(ROUTES.filter((route) => !route.startsWith("inventory+/ship")))
    ).toEqual([
      [
        "packages/database/src/access/pages/inventory.ts",
        "/x/inventory/shipments"
      ]
    ]);
  });
});
