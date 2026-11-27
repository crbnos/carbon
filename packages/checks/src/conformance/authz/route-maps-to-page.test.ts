// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../sources/migrations";
import { routeMapsToPage } from "./route-maps-to-page";

const THIS_CHECK =
  "packages/checks/src/conformance/authz/route-maps-to-page.ts";

const PAGES = [
  { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
  { id: "inventory.shipments", paths: ["/x/inventory/shipments"] }
];

// `_index.tsx` is `/x` and `account+/profile.tsx` is under `/x/account/`,
// both in UNPAGED_ROUTES.
const ROUTES = [
  "_index.tsx",
  "inventory+/receipts.tsx",
  "inventory+/receipts.$id.tsx",
  "inventory+/shipments.tsx",
  "account+/profile.tsx"
];

// Every other UNPAGED_ROUTES entry matches none of these routes, so its
// finding is left out here.
const routeGaps = (routes: string[], pages = PAGES) =>
  routeMapsToPage
    .find({ routes, pages })
    .filter((v) => v.file !== THIS_CHECK)
    .map(({ file, snippet }) => [file, snippet]);

describe("routeMapsToPage", () => {
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
      routeGaps(ROUTES, [
        ...PAGES,
        { id: "purchasing.receipts", paths: ["/x/inventory/receipts/"] }
      ])
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
      routeGaps(
        [...ROUTES, "print.tsx"],
        [...PAGES, { id: "settings.printing", paths: ["/x/print"] }]
      )
    ).toEqual([["apps/erp/app/routes/x+/print.tsx", "/x/print"]]);
  });

  it("matches a page path's $param to any one segment, as pageOfUrl does", () => {
    expect(
      routeGaps(
        [...ROUTES, "customer+/$id.details.tsx"],
        [
          ...PAGES,
          { id: "sales.customers", paths: ["/x/customer/$customerId"] }
        ]
      )
    ).toEqual([]);
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

  it("flags an UNPAGED_ROUTES entry that matches no route, in this check's own file", () => {
    const stale = routeMapsToPage
      .find({ routes: [], pages: [] })
      .filter((v) => v.snippet === "/x/print")
      .map(({ file, snippet }) => [file, snippet]);
    expect(stale).toEqual([[THIS_CHECK, "/x/print"]]);
    expect(existsSync(join(repoRoot(), THIS_CHECK))).toBe(true);
  });
});
