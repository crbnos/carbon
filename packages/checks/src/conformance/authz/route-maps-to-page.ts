// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { PAGES } from "@carbon/database/access";
import { defineCheck } from "../../check";
import {
  findRoutePageGaps,
  loadErpRouteFiles
} from "../../sources/route-pages";

// Every ERP route under `x+` belongs to one page of the access registry, so a
// gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed
// in UNPAGED_ROUTES below with the reason (`findRoutePageGaps`).
export const routeMapsToPage = defineCheck({
  id: "route-maps-to-page",
  description:
    "Every ERP route under `x+` belongs to one page of the access registry, so a gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed in `UNPAGED_ROUTES` with the reason.",
  reads: { routes: loadErpRouteFiles },
  rule() {
    // The finding for a stale UNPAGED_ROUTES entry points here.
    const thisFile =
      "packages/checks/src/conformance/authz/route-maps-to-page.ts";

    /**
     * Routes under `x+` that belong to no one page, with the reason. A key that
     * ends with `/` covers its own URL and every route below it; any other key is
     * one route.
     */
    const UNPAGED_ROUTES: Readonly<Record<string, string>> = {
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
      "/x/force-delete/":
        "The Admin force delete of a purchase invoice, sales invoice, receipt or payment; the document's type picks the page.",
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

    return ({ routes }) =>
      findRoutePageGaps(
        routes,
        { pages: PAGES },
        { file: thisFile, routes: UNPAGED_ROUTES }
      );
  }
});
