// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// An index route that renders nothing exists to redirect (`/x/issue/:id` →
// `…/details`). React Router runs the loaders of a matched branch in parallel,
// so its parents' loaders ran in full for a request that was about to be
// redirected: one hover prefetch of a bare issue link cost ~20 queries, thrown
// away, and a click cost them twice. Exporting the redirect as middleware runs
// it before any loader.
const INDEX_ROUTE = /\/app\/routes\/(?:.*[/.])?_index\.tsx$/;
const LOADER = /^export\s+(?:async\s+function|function|const)\s+loader\b/m;
const DEFAULT_EXPORT = /^export\s+default\b|^export\s*\{[^}]*\bdefault\b/m;
const REDIRECT = /\bredirect\s*\(/;
const MIDDLEWARE =
  /^export\s+const\s+middleware\b[^;]*\bredirectBeforeLoaders\s*\(\s*loader\s*\)/m;

export const indexRedirectBeforeLoaders: ConformanceCheck = {
  id: "index-redirect-before-loaders",
  description:
    "An index route that only redirects must run the redirect before its parents' loaders",
  provenance: {
    deprecates:
      "a redirect-only index route whose redirect runs alongside its parents' loaders",
    replacedBy:
      "export const middleware = [redirectBeforeLoaders(loader)] (@carbon/utils)",
    since: "2026-10-02"
  },
  scan(file: string, contents: string): Violation[] {
    if (!INDEX_ROUTE.test(file)) return [];
    const loader = LOADER.exec(contents);
    // A route with a default export renders a page; one without a redirect is
    // a resource route. Neither is a redirect-only route.
    if (!loader || DEFAULT_EXPORT.test(contents) || !REDIRECT.test(contents)) {
      return [];
    }
    if (MIDDLEWARE.test(contents)) return [];
    const line = contents.slice(0, loader.index).split("\n").length;
    return [
      {
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message:
          "Add `export const middleware = [redirectBeforeLoaders(loader)];` (@carbon/utils) so the redirect runs before the parents' loaders"
      }
    ];
  }
};
