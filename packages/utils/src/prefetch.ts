// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Lets the browser keep a prefetched response for a few seconds, so the click
 * that follows is answered from it instead of asking the server again.
 *
 *   export const middleware = [..., prefetchCacheMiddleware];
 *
 * Page data is served without a lifetime, so a `<link rel="prefetch">` was
 * never reused: the click made a second request, and the browser held it until
 * the prefetch's response arrived. Only a prefetch gets the lifetime, and only
 * `private`: a navigation, a revalidation after a save and a realtime reload
 * still go to the server. The fix React Router points to for this
 * (remix-run/react-router#13255).
 */
export const PREFETCH_MAX_AGE_SECONDS = 5;

// Browsers have named the header differently over the years.
const PURPOSE_HEADERS = [
  "Sec-Purpose",
  "Purpose",
  "X-Purpose",
  "Sec-Fetch-Purpose",
  "X-Moz"
];

export function isPrefetchRequest(request: Request) {
  if (request.method !== "GET") return false;
  return PURPOSE_HEADERS.some((name) =>
    request.headers.get(name)?.toLowerCase().startsWith("prefetch")
  );
}

export async function prefetchCacheMiddleware<Result>(
  { request }: { request: Request },
  next: () => Promise<Result>
): Promise<Result> {
  const response = await next();
  if (
    !(response instanceof Response) ||
    response.status !== 200 ||
    response.headers.has("Cache-Control") ||
    !isPrefetchRequest(request)
  ) {
    return response;
  }
  const value = `private, max-age=${PREFETCH_MAX_AGE_SECONDS}`;
  try {
    response.headers.set("Cache-Control", value);
    return response;
  } catch {
    // Immutable headers (a proxied `fetch` response): copy, then set.
    const copy = new Response(response.body, response);
    copy.headers.set("Cache-Control", value);
    return copy as Result;
  }
}
