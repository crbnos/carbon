// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { pageOfUrl, routeUrl } from "@carbon/database/access";
import type { CallExpression } from "oxc-parser";
import { defineCheck, eachFile, type Violation } from "../../check";
import {
  erpModuleTypescript,
  listRegistryTypescript,
  routeTypescript
} from "../../sources/inputs";
import { gateConstants, listGates, pagesNamed } from "../../sources/page-gates";
import { erpRouteOf } from "../../sources/route-pages";
import { parseTypescript, walk } from "../../sources/syntax";
import { lineOf } from "../../sources/text";

// A route's gate, the `authorize` gate or the gate of the list it loads with
// `loadListPage`, names the page its URL belongs to (`pageOfUrl`), or a list
// of pages that holds it, so the sidebar, the registry `paths` and the gate
// agree on whose screen it is.
export const routeGateNamesPage = defineCheck({
  id: "route-gate-names-page",
  description:
    "An ERP route's authorize gate names the page its URL maps to in the access registry",
  provenance: {
    deprecates:
      "a route gate that names another page than the registry `paths` give its URL",
    replacedBy:
      "gate on `pageOfUrl(route)`, move the URL in the registry, or list the route in ROUTE_GATE_EXCEPTIONS with the reason",
    since: "2026-11-10"
  },
  reads: {
    routes: routeTypescript,
    modules: erpModuleTypescript,
    lists: listRegistryTypescript
  },
  rule() {
    type Exception = { pages: readonly string[]; reason: string };

    const INSPECTION_PLAN_ASSIGNMENT: Exception = {
      pages: ["quality.inspectionPlans"],
      reason:
        "the item's Quality tab assigns inspection plans: it writes itemInspectionDocumentAssignment, an Inspection Plans table"
    };

    const RENTAL_RATES: Exception = {
      pages: ["sales.rentalAgreements"],
      reason:
        "the item's rental rates are Rental Agreements tables (itemRentalRate, customerItemRentalRate), edited from the item's Sales tab"
    };

    /**
     * Routes whose gate may name other pages than the one their URL maps to, and
     * why. Keyed by the route file under `apps/erp/app/routes/x+/`. A gate passes
     * when it names the URL's page or one of `pages`.
     */
    const ROUTE_GATE_EXCEPTIONS: Readonly<Record<string, Exception>> = {
      "part+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
      "material+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
      "tool+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
      "consumable+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
      "service+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
      "part+/$itemId.sales.tsx": RENTAL_RATES,
      "part+/$itemId.sales.rental-rates.new.tsx": RENTAL_RATES,
      "part+/$itemId.sales.rental-rates.$rateId.tsx": RENTAL_RATES,
      "part+/$itemId.sales.rental-rates.delete.$rateId.tsx": RENTAL_RATES,
      "projects+/timesheets.$employeeId.tsx": {
        pages: ["projects.approvals"],
        reason:
          "an approver reviews one person's time here: an Approvals screen, opened under /x/projects/timesheets"
      },
      "users+/operators.reset-pin.$operatorId.tsx": {
        pages: ["settings.people"],
        reason:
          "resetting the PIN of an employee who is not a console operator is a People setting, as resetConsoleOperatorPin checks"
      }
    };

    /** The gate argument of an `authorize` call, or the list of a `loadListPage` call. */
    const gateOfCall = (
      node: CallExpression,
      constants: ReadonlyMap<string, readonly string[]>,
      lists: ReadonlyMap<string, readonly string[]>
    ): string[] | undefined => {
      const argument = node.arguments[1];
      if (node.callee.type !== "Identifier" || !argument) return undefined;
      if (node.callee.name === "authorize")
        return pagesNamed(argument, constants);
      if (
        node.callee.name === "loadListPage" &&
        argument.type === "Identifier"
      ) {
        const pages = lists.get(argument.name);
        return pages ? [...pages] : undefined;
      }
      return undefined;
    };

    return ({ routes, modules, lists }) => {
      const constants = gateConstants(modules);
      const listPages = listGates(lists);
      return eachFile(routes, (file, contents) => {
        const route = erpRouteOf(file);
        if (
          !route ||
          !(
            contents.includes("authorize(") ||
            contents.includes("loadListPage(")
          )
        )
          return [];
        const page = pageOfUrl(routeUrl(route));
        if (!page) return [];
        const allowed = new Set([
          page,
          ...(ROUTE_GATE_EXCEPTIONS[file.slice(file.indexOf("x+/") + 3)]
            ?.pages ?? [])
        ]);
        const out: Violation[] = [];
        walk(parseTypescript(file, contents).program, (node) => {
          if (node.type !== "CallExpression") return;
          const pages = gateOfCall(node, constants, listPages);
          if (pages?.length && !pages.some((named) => allowed.has(named))) {
            const line = lineOf(contents, node.start);
            out.push({
              file,
              line,
              snippet: contents.split("\n")[line - 1]?.trim() ?? "",
              message: `The gate names ${[...new Set(pages)].join(", ")}, but the registry maps ${routeUrl(route)} to ${page}. Gate on ${page}, move the URL to the right page's \`paths\`, or add the route to ROUTE_GATE_EXCEPTIONS with the reason.`
            });
          }
        });
        return out;
      });
    };
  }
});
