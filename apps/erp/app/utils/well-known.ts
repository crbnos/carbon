/**
 * Which `/.well-known/...` requests the server entry answers itself.
 *
 * Browsers and scanners probe this prefix constantly (`security.txt`,
 * `apple-app-site-association`, Chrome devtools' `appspecific` path), and none
 * of those have routes. `server/app.ts` answers them with an empty 204 before
 * `createRequestHandler` runs, which keeps "No route matches" out of the logs.
 *
 * That check used to be an unconditional `pathname.startsWith("/.well-known/")`,
 * which silently made every REAL `.well-known` route unreachable — including
 * `/.well-known/oauth-protected-resource`, the URL the MCP endpoint hands
 * clients in its 401 `WWW-Authenticate` header. It returned an empty 204 in
 * production instead of its JSON, so OAuth discovery for the remote connector
 * could not complete. Routed paths must reach the router; only unrouted ones are
 * short-circuited.
 */

export const WELL_KNOWN_PREFIX = "/.well-known/";

type RouteManifestEntry = { path?: string } | undefined;

/**
 * The `/.well-known/...` paths the router actually serves, read from the build
 * manifest. Derived rather than listed, so adding a `.well-known` route serves
 * it without anyone remembering to update the server entry.
 */
export function wellKnownRoutePaths(
  routes: Record<string, RouteManifestEntry> | undefined
): Set<string> {
  const paths = new Set<string>();

  for (const route of Object.values(routes ?? {})) {
    const path = route?.path;
    if (!path) continue;

    // Manifest paths are root-relative without a leading slash
    // (`.well-known/oauth-protected-resource`).
    const absolute = path.startsWith("/") ? path : `/${path}`;
    if (absolute.startsWith(WELL_KNOWN_PREFIX)) paths.add(absolute);
  }

  return paths;
}

/** True when this is a `.well-known` probe with no route behind it. */
export function isUnroutedWellKnownPath(
  pathname: string,
  routedPaths: ReadonlySet<string>
): boolean {
  return pathname.startsWith(WELL_KNOWN_PREFIX) && !routedPaths.has(pathname);
}
