// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  pagesOfUrl,
  routeUrl,
  urlCoverage,
  urlSegments
} from "@carbon/database/access";
import type { Violation } from "../check";

/** The ERP route tree whose files map to pages. */
export const ERP_ROUTES_DIR = "apps/erp/app/routes/x+";

const PAGES_DIR = "packages/database/src/access/pages";

/** The route of an ERP route file under `x+` (`inventory+/receipts`), or undefined for any other file. */
export function erpRouteOf(file: string): string | undefined {
  return /^apps\/erp\/app\/routes\/x\+\/(.+)\.tsx?$/.exec(file)?.[1];
}

/**
 * The ERP route files under `x+` that `findRoutePageGaps` maps, relative to
 * `x+`: the files remix-flat-routes builds routes from (`apps/erp/app/routes.ts`
 * ignores dot folders, `__` names and `.server`/`.client`/`.test` files).
 */
export function loadErpRouteFiles(root: string): string[] {
  return readdirSync(join(root, ERP_ROUTES_DIR), {
    encoding: "utf8",
    recursive: true
  })
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        /\.(tsx?|jsx?)$/.test(file) &&
        !file.split("/").some((part) => part.startsWith(".")) &&
        !/(^|\/)__|\.(server|client|test)\./.test(file)
    )
    .sort();
}

/** The registry facts `findRoutePageGaps` needs. */
export type RouteRegistry = {
  pages: readonly { id: string; paths: readonly string[] }[];
};

/** Routes that belong to no one page, with the reason, and the file that lists them. */
export type UnpagedRoutes = {
  file: string;
  routes: Readonly<Record<string, string>>;
};

/** Whether an unpaged-routes key lists the URL (plain text: no `$param`). */
const unpaged = (key: string, url: string) => {
  if (!key.endsWith("/")) return url === key;
  const path = key.slice(0, -1);
  return url === path || url.startsWith(key);
};

/**
 * Every ERP route under `x+` belongs to one page of the access registry, so a
 * gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed
 * in UNPAGED_ROUTES with the reason. `routes` are the route files relative
 * to `x+` (`inventory+/receipts.tsx`). A key of UNPAGED_ROUTES that ends with
 * `/` covers its own URL and every route below it; any other key is one route.
 *
 * It fails:
 * - a route no page covers and UNPAGED_ROUTES does not list, one that two
 *   pages cover equally (where `pageOfUrl` would pick by order), and one that
 *   is both on a page and listed;
 * - an UNPAGED_ROUTES entry that matches no route;
 * - a page path that matches no route.
 */
export function findRoutePageGaps(
  routes: readonly string[],
  registry: RouteRegistry,
  unpagedRoutes: UnpagedRoutes
): Violation[] {
  const violations: Violation[] = [];
  const push = (file: string, snippet: string, message: string) =>
    violations.push({ file, line: 0, snippet, message });
  const urls = routes.map((route) => ({ route, url: routeUrl(route) }));
  const keys = Object.keys(unpagedRoutes.routes);

  for (const { route, url } of urls) {
    const file = `${ERP_ROUTES_DIR}/${route}`;
    const pages = pagesOfUrl(url, registry.pages);
    const listed = keys.some((key) => unpaged(key, url));
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

  for (const key of keys)
    if (!urls.some(({ url }) => unpaged(key, url)))
      push(
        unpagedRoutes.file,
        key,
        `UNPAGED_ROUTES lists ${key}, which no route has`
      );

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
