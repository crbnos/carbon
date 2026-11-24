// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { nameParts, sqlNodes } from "../sources/sql";
import { GENERATED_AUTHZ_MIGRATION } from "./no-authz-ddl-in-migrations";

export const noLegacyRls: ConformanceCheck = {
  id: "no-legacy-rls",
  description:
    "Use get_companies_with_employee_permission(...), not has_role()/has_company_permission().",
  provenance: {
    deprecates: "has_company_permission()",
    replacedBy: "get_companies_with_employee_permission()",
    since: "20250201181148_rls-refactor.sql"
  },
  scan(file, contents) {
    // Rendered from packages/database/src/authz, which owns the deprecated helpers' own
    // definitions until they can be dropped.
    if (contents.startsWith(GENERATED_AUTHZ_MIGRATION)) return [];
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("FuncCall" in node)) continue;
      const { funcname, location } = node.FuncCall;
      if (nameParts(funcname).at(-1) !== "has_company_permission") continue;
      violations.push({
        file,
        line: fragment.lineAt(location),
        snippet: "has_company_permission(",
        message:
          "Deprecated RLS helper; use get_companies_with_employee_permission()."
      });
    }
    return violations;
  }
};
