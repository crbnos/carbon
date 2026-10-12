// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * For an index route whose loader only redirects
 * (`/x/issue/:id` → `/x/issue/:id/details`, `/x/settings` → its first page):
 *
 *   export const middleware = [redirectBeforeLoaders(loader)];
 *
 * The loaders of a matched branch run in parallel, so every parent's loader
 * ran in full for a request the index was about to redirect — once per
 * prefetch of the bare URL, and twice per click. Middleware runs before any
 * loader, so the redirect is all such a request costs.
 *
 * GET and HEAD only: a form may post to the bare URL to reach a parent's
 * action. The loader stays exported, since it is what makes a client
 * navigation to the bare URL ask the server at all. A fetcher that LOADS the
 * bare URL to read a parent's data would be redirected as well.
 *
 * Every index route that has a loader and renders nothing must export this:
 * the `index-redirect-before-loaders` check (`@carbon/checks`) enforces it.
 */
export function redirectBeforeLoaders<Args extends { request: Request }>(
  loader: (args: Args) => unknown
) {
  return async <Result>(
    args: Args,
    next: () => Promise<Result>
  ): Promise<Result> => {
    const { method } = args.request;
    if (method === "GET" || method === "HEAD") {
      // A loader may return its redirect instead of throwing it.
      const result = await loader(args);
      if (result instanceof Response) return result as Result;
    }
    return next();
  };
}

const HOME = "/";

type RedirectTarget = FormDataEntryValue | null | undefined;

// Never a real host: only what a target resolves to against it is compared.
const BASE = "https://own.invalid";

function isOwnPath(to: RedirectTarget): to is string {
  if (typeof to !== "string" || !to.startsWith("/")) return false;
  // Resolved the way a browser resolves a Location header, rather than by
  // listing the spellings of another origin: `//host`, `/\host`, and `/` then
  // a tab or newline then `/host` (browsers drop those characters) all leave.
  try {
    return new URL(to, BASE).origin === BASE;
  } catch {
    return false;
  }
}

/** `to` when it is a path on this origin, otherwise `fallback`. */
export function safePath(to: RedirectTarget, fallback: string = HOME): string {
  return isOwnPath(to) ? to : fallback;
}

function redirectResponse(url: string, init: number | ResponseInit = 302) {
  const responseInit = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(responseInit.headers);
  headers.set("Location", url);
  return new Response(null, {
    ...responseInit,
    status: responseInit.status ?? 302,
    headers
  });
}

/**
 * The only `redirect` a loader or action uses (`no-raw-redirect` check). It
 * goes to a path on this origin; anything else — an absolute URL, `//host`, an
 * empty value — lands on the home page, so a destination read from a query
 * string, a form or a database row cannot send the browser off-site.
 *
 * Leaving the origin on purpose (an OAuth provider, Stripe, the other app) is
 * `redirectExternal`.
 */
export function redirect(to: RedirectTarget, init?: number | ResponseInit) {
  if (!isOwnPath(to)) {
    if (to) console.warn("redirect: refused a target off this origin", { to });
    return redirectResponse(HOME, init);
  }
  return redirectResponse(to, init);
}

/**
 * A redirect that leaves this origin. The URL must be one the server built —
 * never a value a request supplied — and must be http(s).
 */
export function redirectExternal(url: string, init?: number | ResponseInit) {
  let protocol: string | undefined;
  try {
    protocol = new URL(url).protocol;
  } catch {
    // not an absolute URL
  }
  if (protocol !== "https:" && protocol !== "http:") {
    console.warn("redirectExternal: refused a URL that is not http(s)", {
      url
    });
    return redirectResponse(HOME, init);
  }
  return redirectResponse(url, init);
}
