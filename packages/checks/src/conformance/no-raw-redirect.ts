// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// React Router's redirect goes wherever it is told. A destination read from a
// query string or a form then sends the browser off-site unless the call site
// remembered to validate it — one signup route did not. `redirect` from
// @carbon/utils only goes to a path on this origin; `redirectExternal` is the
// named way to leave it.
const RAW_IMPORT =
  /import\s*\{[^}]*?\b(redirect|redirectDocument|replace)\b[^}]*\}\s*from\s*["']react-router["']/g;

export const noRawRedirect: ConformanceCheck = {
  id: "no-raw-redirect",
  description: "Redirect with redirect / redirectExternal from @carbon/utils",
  provenance: {
    deprecates:
      "redirect from react-router, and validating the target at the call site",
    replacedBy: "redirect, redirectExternal (@carbon/utils)",
    since: "2026-10-04"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const match of contents.matchAll(RAW_IMPORT)) {
      const line = contents.slice(0, match.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: `import { ${match[1]} } from "react-router"`,
        message:
          match[1] === "redirect"
            ? "Import redirect from @carbon/utils; use redirectExternal to leave this origin"
            : `${match[1]} from react-router goes wherever it is told; use redirect from @carbon/utils`
      });
    }
    return violations;
  }
};
