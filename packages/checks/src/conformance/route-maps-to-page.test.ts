// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findRoutePageGaps, type RouteRegistry } from "./route-maps-to-page";

const PAGE_OF_URL: Record<string, string> = {
  "/x/inventory/receipts": "inventory.receipts",
  "/x/inventory/receipts/$id": "inventory.receipts",
  "/x/inventory/shipments": "inventory.shipments"
};

const registry = (overrides: Partial<RouteRegistry> = {}): RouteRegistry => ({
  pages: [
    { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
    { id: "inventory.shipments", paths: ["/x/inventory/shipments"] }
  ],
  pageOfUrl: (url) => PAGE_OF_URL[url],
  ...overrides
});

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

const gaps = (
  routes: readonly string[],
  overrides: Partial<RouteRegistry> = {},
  unpaged: Record<string, string> = UNPAGED
) =>
  findRoutePageGaps(routes, registry(overrides), unpaged).map(
    ({ file, snippet }) => [file, snippet]
  );

describe("findRoutePageGaps", () => {
  it("passes routes each on one page, and routes UNPAGED_ROUTES lists", () => {
    expect(gaps(ROUTES)).toEqual([]);
  });

  it("flags a route on no page that UNPAGED_ROUTES does not list", () => {
    expect(gaps([...ROUTES, "inventory+/kanbans.tsx"])).toEqual([
      ["apps/erp/app/routes/x+/inventory+/kanbans.tsx", "/x/inventory/kanbans"]
    ]);
  });

  it("flags a route two pages cover equally", () => {
    expect(
      gaps(ROUTES, {
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
      gaps(ROUTES, {}, { ...UNPAGED, "/x/inventory/shipments": "Listed." })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/shipments.tsx",
        "/x/inventory/shipments"
      ]
    ]);
  });

  it("flags a route pageOfUrl puts on another page", () => {
    expect(
      gaps(ROUTES, {
        pageOfUrl: (url) =>
          url === "/x/inventory/shipments"
            ? "inventory.receipts"
            : PAGE_OF_URL[url]
      })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/shipments.tsx",
        "/x/inventory/shipments"
      ]
    ]);
  });

  it("flags an UNPAGED_ROUTES entry that matches no route", () => {
    expect(gaps(ROUTES, {}, { ...UNPAGED, "/x/print": "Gone." })).toEqual([
      ["packages/checks/src/conformance/route-maps-to-page.ts", "/x/print"]
    ]);
  });

  it("flags a page path no route has", () => {
    expect(
      gaps(ROUTES.filter((route) => !route.startsWith("inventory+/ship")))
    ).toEqual([
      [
        "packages/database/src/access/pages/inventory.ts",
        "/x/inventory/shipments"
      ]
    ]);
  });
});
