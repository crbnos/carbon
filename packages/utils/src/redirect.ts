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
