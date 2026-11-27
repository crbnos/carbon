// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import { lineOf } from "../../sources/text";

// React Router's `revalidate()` during an action drops the fetcher's redirect,
// and during the navigation that follows a save it restarts that navigation
// without the submission. `useRevalidator` from `@carbon/query` holds the call
// until the router is idle.
export const noRawRevalidator = defineCheck({
  files: typescript,
  id: "no-raw-revalidator",
  description:
    "useRevalidator must come from @carbon/query, which holds a revalidation while a save is in flight",
  provenance: {
    deprecates: 'import { useRevalidator } from "react-router"',
    replacedBy: 'import { useRevalidator } from "@carbon/query"',
    since: "2026-10-06"
  },
  rule() {
    const routerImport =
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']react-router["']/g;
    // The wrapper itself: the one place that takes React Router's.
    const definition = "packages/react/src/hooks/useRevalidator.ts";

    return (file, contents) => {
      if (file === definition) return [];
      const violations: Violation[] = [];
      for (const match of contents.matchAll(routerImport)) {
        if (!/\buseRevalidator\b/.test(match[1] ?? "")) continue;
        const line = lineOf(contents, match.index);
        violations.push({
          file,
          line,
          snippet: contents.split("\n")[line - 1]?.trim() ?? "",
          message:
            "Import `useRevalidator` from \"@carbon/query\": React Router's can drop a save's redirect or restart the navigation that follows it"
        });
      }
      return violations;
    };
  }
});
