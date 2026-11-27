// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { routeTypescript } from "../../sources/inputs";
import { lineOf } from "../../sources/text";

// An index route that renders nothing exists to redirect (`/x/issue/:id` →
// `…/details`). React Router runs the loaders of a matched branch in parallel,
// so its parents' loaders ran in full for a request that was about to be
// redirected: one hover prefetch of a bare issue link cost ~20 queries, thrown
// away, and a click cost them twice. Exporting the redirect as middleware runs
// it before any loader.
export const indexRedirectBeforeLoaders = defineCheck({
  files: routeTypescript,
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
  rule() {
    const indexRoute = /\/app\/routes\/(?:.*[/.])?_index\.tsx$/;
    const loaderExport =
      /^export\s+(?:async\s+function|function|const)\s+loader\b/m;
    const defaultExport = /^export\s+default\b|^export\s*\{[^}]*\bdefault\b/m;
    const redirectCall = /\bredirect\s*\(/;
    const middleware =
      /^export\s+const\s+middleware\b[^;]*\bredirectBeforeLoaders\s*\(\s*loader\s*\)/m;
    return (file, contents) => {
      if (!indexRoute.test(file)) return [];
      const loader = loaderExport.exec(contents);
      // A route with a default export renders a page; one without a redirect is
      // a resource route. Neither is a redirect-only route.
      if (
        !loader ||
        defaultExport.test(contents) ||
        !redirectCall.test(contents)
      ) {
        return [];
      }
      if (middleware.test(contents)) return [];
      const line = lineOf(contents, loader.index);
      return [
        {
          file,
          line,
          snippet: contents.split("\n")[line - 1]?.trim() ?? "",
          message:
            "Add `export const middleware = [redirectBeforeLoaders(loader)];` (@carbon/utils) so the redirect runs before the parents' loaders"
        }
      ];
    };
  }
});
