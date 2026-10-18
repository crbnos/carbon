// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// ERP code authenticates a request with `authorize`, which returns the caller
// and the service functions bound to them. It replaced three entry points
// that each did part of that job.
const IMPORT =
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](@carbon\/auth\/auth\.server|@carbon\/api\/carbon\.server)["']/g;

const REPLACED: Record<string, string[]> = {
  "@carbon/auth/auth.server": ["requirePermissions"],
  "@carbon/api/carbon.server": ["carbon", "carbonFor"]
};

export const erpAuthorizeOnly: ConformanceCheck = {
  id: "erp-authorize-only",
  description:
    "ERP code authenticates a request with authorize (@carbon/api/carbon.server)",
  provenance: {
    deprecates:
      "requirePermissions, carbon(request) and carbonFor(auth) in ERP code",
    replacedBy: "authorize(request, gate?) (@carbon/api/carbon.server)",
    since: "2026-10-18"
  },
  scan(file: string, contents: string): Violation[] {
    if (!file.startsWith("apps/erp/app/")) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(IMPORT)) {
      const module = match[2]!;
      const names = match[1]!.split(",").map(
        (n) =>
          n
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? ""
      );
      for (const name of names) {
        if (!REPLACED[module]?.includes(name)) continue;
        violations.push({
          file,
          line: contents.slice(0, match.index).split("\n").length,
          snippet: `import { ${name} } from "${module}"`,
          message: `Use authorize(request, gate?) from @carbon/api/carbon.server: it returns the caller and api in place of ${name}`
        });
      }
    }
    return violations;
  }
};
