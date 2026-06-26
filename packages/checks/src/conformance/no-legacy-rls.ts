import type { ConformanceCheck, Violation } from "../check";

const LEGACY_RLS = /has_company_permission\s*\(/gi;

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
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(LEGACY_RLS)) {
        violations.push({
          file,
          line: i + 1,
          snippet: m[0],
          message:
            "Deprecated RLS helper; use get_companies_with_employee_permission()."
        });
      }
    });
    return violations;
  }
};
