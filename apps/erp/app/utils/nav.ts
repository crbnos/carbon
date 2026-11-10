// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type ExpandedClaims,
  type Gate,
  landingOf,
  type ModuleId,
  type PageId,
  pageOfUrl
} from "@carbon/database/access";
import type { Route } from "~/types";

/** A module that opens on another page than its first one, when the person can view it. */
const PREFERRED_PAGE: Partial<Record<ModuleId, PageId>> = {
  settings: "settings.company"
};

/**
 * Where a module's link and its `_index` redirect take a person: the first
 * page of the module they can view (`landingOf`). Undefined when they can
 * view none.
 */
export function moduleLanding(
  module: ModuleId,
  permissions: ExpandedClaims | null | undefined,
  companyId: string
): string | undefined {
  return landingOf(module, permissions, companyId, {
    prefer: PREFERRED_PAGE[module]
  })?.path;
}

type NavRoute = Pick<Route, "to" | "page" | "gate">;

type NavPermissions = { has: (gate: Gate) => boolean };

/** The page a sidebar entry opens: its `page`, else the page of its `to`. */
export function pageOfRoute(
  route: Pick<Route, "to" | "page">
): PageId | undefined {
  return route.page ?? pageOfUrl(route.to);
}

/** The gate a sidebar entry shows behind: its `gate`, else View on its page. */
export function gateOfRoute(route: Pick<Route, "to" | "page" | "gate">): Gate {
  if (route.gate) return route.gate;
  const page = pageOfRoute(route);
  return page ? { [page]: "View" } : {};
}

const segments = (url: string) =>
  (url.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);

/** How many segments of `to` the URL starts with; 0 when it does not start with all of them. */
function coverage(to: string, url: readonly string[]): number {
  const want = segments(to);
  return want.every((part, i) => url[i] === part) ? want.length : 0;
}

type ActiveRoute = Pick<Route, "to" | "page">;

const ownsPage = (route: ActiveRoute, pathname: string) => {
  const page = pageOfRoute(route);
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
  const url = segments(pathname);
  const best = Math.max(
    ...[route, ...siblings]
      .filter((sibling) => ownsPage(sibling, pathname))
      .map((sibling) => coverage(sibling.to, url))
  );
  return coverage(route.to, url) === best;
}

/** The entries a person sees: those whose gate they pass and that `extraRule` keeps. */
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

/** `visibleRoutes` for each group; a group left with no entry goes. */
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
