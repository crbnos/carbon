// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Gate,
  moduleOf,
  pageOfUrl,
  urlCoverage,
  urlSegments
} from "@carbon/database/access";
import type { Route } from "~/types";
import type { Handle } from "~/utils/handle";

type ModuleMatch = { pathname: string; handle?: unknown };

/**
 * The module the page on screen belongs to: that of the outermost matched
 * route that names one, by the page its URL belongs to or, for a route no
 * page covers (a module's layout, a memo's detail), by its `handle.module`.
 * Outermost, so a record's tab that another module's page owns (a customer's
 * bank accounts) stays in the record's module.
 */
export function moduleOfMatches(
  matches: readonly ModuleMatch[]
): string | undefined {
  for (const match of matches) {
    const page = pageOfUrl(match.pathname);
    if (page) return moduleOf(page);
    const module = (match.handle as Handle | undefined)?.module;
    if (module) return module;
  }
  return undefined;
}

type NavRoute = Pick<Route, "to" | "gate">;

type NavPermissions = { has: (gate: Gate) => boolean };

/**
 * The gate of a record's link to another module's list, filtered to the
 * record: it shows to everyone who can open the record, and the list checks
 * its own page.
 */
export const OPEN_LIST: Gate = {};

export function gateOfRoute(route: NavRoute): Gate {
  if (route.gate) return route.gate;
  const page = pageOfUrl(route.to);
  return page ? { [page]: "View" } : {};
}

type ActiveRoute = Pick<Route, "to">;

const ownsPage = (route: ActiveRoute, pathname: string) => {
  const page = pageOfUrl(route.to);
  return page ? pageOfUrl(pathname) === page : pathname.includes(route.to);
};

/**
 * Whether a sidebar entry is the one for the URL: its page is the page the
 * URL belongs to (the longest registry path wins), or for an entry with no
 * page, the URL contains its `to`. When several `siblings` qualify, the one
 * whose `to` the URL starts with, longest first, wins.
 */
export function routeOwnsUrl(
  route: ActiveRoute,
  pathname: string,
  siblings: readonly ActiveRoute[] = []
): boolean {
  if (!ownsPage(route, pathname)) return false;
  const url = urlSegments(pathname);
  const best = Math.max(
    ...[route, ...siblings]
      .filter((sibling) => ownsPage(sibling, pathname))
      .map((sibling) => urlCoverage(sibling.to, url))
  );
  return urlCoverage(route.to, url) === best;
}

export function visibleRoutes<R extends NavRoute>(
  routes: readonly R[],
  permissions: NavPermissions,
  extraRule?: (route: R) => boolean
): R[] {
  return routes.filter(
    (route) =>
      permissions.has(gateOfRoute(route)) && (extraRule?.(route) ?? true)
  );
}

export function visibleGroups<G extends { routes: readonly NavRoute[] }>(
  groups: readonly G[],
  permissions: NavPermissions,
  extraRule?: (route: G["routes"][number]) => boolean
): (Omit<G, "routes"> & { routes: G["routes"][number][] })[] {
  return groups
    .map((group) => ({
      ...group,
      routes: visibleRoutes(group.routes, permissions, extraRule)
    }))
    .filter((group) => group.routes.length > 0);
}
